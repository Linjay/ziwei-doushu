'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import BirthForm, { validBirthDate, type BirthFormState } from './BirthForm';
import ChartBoard from './ChartBoard';
import RecordHeader from './RecordHeader';
import ReadingText from './ReadingText';
import ReadingModeSwitch from './ReadingModeSwitch';
import ReadingGuide from './ReadingGuide';
import { professionalReference, readingKey, type ReadingMode } from '@/lib/reading-modes';
import { comparisonProfessional, emptyTopic, mergeTopics, projectComparison, type TopicConversation, type TopicConversations } from '@/lib/insight-topics';
import { useReadingScroll } from '@/lib/use-reading-scroll';
import { ArrowDown, Send } from 'lucide-react';
import { AccountGuard } from './AccountProvider';
import { useChartHistory } from '@/lib/use-chart-history';
import { isComparisonRecord, recordHref, type ComparisonRecord, type InsightMessage, type InsightPhase, type SavedInsight } from '@/lib/chart-history';
import { formToBirthInfo } from '@/lib/ziwei/share';
import { generateChart } from '@/lib/ziwei/algorithm';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { readAIStream } from '@/lib/ai-stream';

const DEFAULT_QUESTION = '请分析双方的性格、相处方式、互补点和需要沟通的问题，分别列出双盘依据，不凭空给出匹配分数。';

export default function ComparisonWorkspace() { return <Suspense fallback={<main className="account-shell">正在读取合盘…</main>}><AccountGuard><Workspace /></AccountGuard></Suspense>; }
function Workspace() {
  const store = useChartHistory(); const router = useRouter();
  const params = useSearchParams(); const destination = useRef<string | null>(null);
  const [view, setView] = useState<{ id: string | null; revision: number } | null>(null);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!store.ready || destination.current === params.toString()) return;
    const id = params.get('new') === '1' ? null : params.get('record') || store.history.activeId;
    const target = store.history.records.find(record => record.id === id);
    if (params.has('record') && target && !isComparisonRecord(target)) { router.replace(recordHref(target)); return; }
    if (params.has('record') && !target) setNotice('未找到这份历史记录，请从列表重新选择。');
    const selected = target && isComparisonRecord(target) ? target.id : null;
    if (params.has('new')) store.select(null);
    else if (selected && store.history.activeId !== selected) store.select(selected);
    destination.current = params.toString();
    setView(previous => ({ id: selected, revision: previous ? previous.revision + (previous.id === selected ? 0 : 1) : 0 }));
  }, [store.ready, store.history, store.select, view, router, params]);
  const fresh = () => { setNotice(''); router.replace(`/heming?new=1&draft=${Date.now()}`); };
  const record = store.history.records.find(record => record.id === view?.id);
  return <main className="account-shell comparison-shell" style={{ maxWidth: 1150 }}>
    <RecordHeader title={record?.label || '紫微合盘'} syncState={store.syncState} error={store.storageError} onRetry={store.retrySync} onNew={fresh} disabled={busy} />
    {notice && <p role="status" className="app-message">{notice}</p>}
    {!store.ready || !view ? <p role="status">正在读取合盘历史…</p> : <Session key={view.revision}
      initialRecord={record && isComparisonRecord(record) ? record : undefined} create={(a, b) => { const id = store.createComparison(a, b); setView(previous => ({ id, revision: previous?.revision || 0 })); router.replace(`/heming?record=${id}`); return id; }} update={store.updateInsight} onBusy={setBusy} />}
  </main>;
}

function Session({ initialRecord, create, update, onBusy }: {
  initialRecord?: ComparisonRecord;
  create: (chart: ZiweiChart, chartB: ZiweiChart) => string;
  update: (id: string, insight: SavedInsight, immediate?: boolean) => void;
  onBusy: (value: boolean) => void;
}) {
  const [charts, setCharts] = useState<[ZiweiChart, ZiweiChart] | null>(initialRecord ? [initialRecord.chart, initialRecord.chartB] : null);
  const [formA, setFormA] = useState<BirthFormState | null>(null); const [formB, setFormB] = useState<BirthFormState | null>(null);
  const [professional,setProfessional]=useState<TopicConversation>(()=>initialRecord?comparisonProfessional(initialRecord.insight,initialRecord.updatedAt):emptyTopic());
  const professionalRef=useRef(professional);
  const [plain,setPlain]=useState<TopicConversations>(initialRecord?.insight.plainTopics||{});const plainRef=useRef(plain);
  const [readingMode,setReadingMode]=useState<ReadingMode>(initialRecord?.insight.readingMode||'professional');const modeRef=useRef(readingMode);const hasModes=useRef(initialRecord?.insight.plainTopics!==undefined);
  const currentConversation=readingMode==='plain'?(plain.overview||emptyTopic()):professional;
  const messages=currentConversation.messages,phase=currentConversation.phase;
  const firstAnswer=messages.findIndex(message=>message.role==='assistant'&&message.content.trim());
  const [analyzing, setAnalyzing] = useState(false);const [questions,setQuestions]=useState({professional:'',plain:''});const question=questions[readingMode];
  const setQuestion=(value:string)=>setQuestions(previous=>({...previous,[modeRef.current]:value}));
  const [error, setError] = useState(''); const [status, setStatus] = useState('');
  const [party, setParty] = useState(0); const [pairTab, setPairTab] = useState('analysis');
  const reader = useReadingScroll(readingKey(readingMode,'comparison'), messages, analyzing);
  const id = useRef<string | null>(initialRecord?.id || null);
  const controller = useRef<AbortController | null>(null); const leaving = useRef(false); const running = useRef(false);
  const requestMode=useRef<ReadingMode>('professional');
  const publish=useCallback((immediate=false)=>{
    if(id.current)update(id.current,hasModes.current?projectComparison(professionalRef.current,plainRef.current,modeRef.current):{messages:professionalRef.current.messages,activeTopic:'overview',phase:professionalRef.current.phase},immediate);
  }, [update]);
  const persist = useCallback((next: InsightMessage[], nextPhase: InsightPhase, immediate = false,mode:ReadingMode=modeRef.current) => {
    const previous=mode==='plain'?(plainRef.current.overview||emptyTopic()):professionalRef.current;
    const value={messages:next,phase:nextPhase,updatedAt:Math.max(Date.now(),previous.updatedAt+1)};
    if(mode==='plain'){hasModes.current=true;plainRef.current={...plainRef.current,overview:value};if(!leaving.current)setPlain(plainRef.current);}
    else{professionalRef.current=value;if(!leaving.current)setProfessional(value);}
    publish(immediate);
  },[publish]);
  const stopCurrent=(nextPhase:InsightPhase='stopped')=>{
    if(!running.current)return;const abort=controller.current;controller.current=null;running.current=false;
    const previous=requestMode.current==='plain'?(plainRef.current.overview||emptyTopic()):professionalRef.current;
    persist(previous.messages.filter(message=>message.role!=='assistant'||message.content.length>0),nextPhase,true,requestMode.current);abort?.abort();
    if(!leaving.current){setAnalyzing(false);setStatus('');}onBusy(false);
  };
  useEffect(()=>{
    if(!initialRecord)return;
    if(initialRecord.insight.plainTopics!==undefined)hasModes.current=true;
    const incoming=comparisonProfessional(initialRecord.insight,initialRecord.updatedAt);
    if(incoming.updatedAt>professionalRef.current.updatedAt){professionalRef.current=incoming;setProfessional(incoming);}
    const merged=mergeTopics(plainRef.current,initialRecord.insight.plainTopics||{});
    if(merged.overview!==plainRef.current.overview){plainRef.current=merged;setPlain(merged);}
  },[initialRecord]);
  useEffect(() => {
    leaving.current = false;
    const interrupt = () => {
      leaving.current = true;
      if (running.current) {
        const previous=requestMode.current==='plain'?(plainRef.current.overview||emptyTopic()):professionalRef.current;
        persist(previous.messages, 'interrupted', true,requestMode.current);
        controller.current?.abort(); controller.current = null; running.current = false;
      }
      onBusy(false);
    };
    const show = () => {
      if (!leaving.current) return;
      leaving.current = false;setProfessional(professionalRef.current);setPlain(plainRef.current); setAnalyzing(false); onBusy(false);
    };
    window.addEventListener('beforeunload', interrupt); window.addEventListener('pagehide', interrupt); window.addEventListener('pageshow', show);
    return () => {
      window.removeEventListener('beforeunload', interrupt); window.removeEventListener('pagehide', interrupt); window.removeEventListener('pageshow', show); interrupt();
    };
  }, [persist, onBusy]);

  const run = async (input?: string,mode:ReadingMode=modeRef.current) => {
    if (running.current) return;
    setError('');
    const asked = input?.trim() || (mode==='plain'?'请把双方的合盘专业解读解释成通俗易懂的话，分别说明甲方、乙方的特点、相处场景与可以尝试的沟通方式。':DEFAULT_QUESTION);
    if (asked.length > 12000) { setError('问题过长，请缩短后重试。'); return; }
    let pair = charts;
    if (!pair) {
      try {
        const ready = (form: BirthFormState | null) => form && validBirthDate(form) && (form.unknownTime || (/^([01]?\d|2[0-3])$/.test(form.clockHour) && /^[0-5]?\d$/.test(form.clockMinute)));
        if (!ready(formA) || !ready(formB)) throw new Error('请先填写双方完整出生信息。');
        pair = [generateChart(formToBirthInfo(formA!)), generateChart(formToBirthInfo(formB!))];
      } catch (error) { setError(error instanceof Error ? error.message : '出生信息不正确，请核对双方日期和时辰。'); return; }
      setCharts(pair); id.current = create(pair[0], pair[1]);
    }
    const conversation=mode==='plain'?(plainRef.current.overview||emptyTopic()):professionalRef.current;
    const prior = [...conversation.messages, { role: 'user' as const, content: asked }];
    reader.startFollowing(readingKey(mode,'comparison'));
    persist([...prior, { role: 'assistant', content: '' }], 'running', true,mode);
    const abort = new AbortController(); controller.current = abort; running.current = true;
    requestMode.current=mode;
    setAnalyzing(true); onBusy(true); setQuestion(''); setStatus('正在检索双方命盘资料…');
    try {
      const response = await fetch('/api/heming', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chartA: pair[0], chartB: pair[1],readingMode:mode,professionalReference:mode==='plain'?professionalReference(professionalRef.current.messages,professionalRef.current.phase):undefined, messages: prior.slice(-10) }) });
      await readAIStream(response, text => {
        if (controller.current === abort && !leaving.current && !abort.signal.aborted) persist([...prior, { role: 'assistant', content: text }], 'running',false,mode);
      }, value => { if (controller.current === abort && !leaving.current) setStatus(value); });
      if (controller.current === abort && !leaving.current && !abort.signal.aborted) persist((mode==='plain'?(plainRef.current.overview||emptyTopic()):professionalRef.current).messages, 'complete', true,mode);
    } catch (error) {
      if (controller.current === abort && !leaving.current) {
        const disconnected = error instanceof TypeError || (error instanceof Error && /连接中断|network|failed to fetch/i.test(error.message));
        persist((mode==='plain'?(plainRef.current.overview||emptyTopic()):professionalRef.current).messages, abort.signal.aborted ? 'stopped' : disconnected ? 'interrupted' : 'error', true,mode);
        if (!abort.signal.aborted) setError(disconnected ? '连接中断，已保留收到的解读，可稍后继续追问。' : error instanceof Error ? error.message : '合盘分析失败，请稍后重试。');
      }
    } finally {
      if (controller.current === abort) {
        running.current = false; controller.current = null;
        if (!leaving.current) { setAnalyzing(false); onBusy(false); setStatus(''); }
      }
    }
  };
  const selectMode=(mode:ReadingMode)=>{
    if(modeRef.current!==mode){stopCurrent('interrupted');modeRef.current=mode;setReadingMode(mode);if(mode==='plain')hasModes.current=true;setError('');publish(true);}
    const value=mode==='plain'?(plainRef.current.overview||emptyTopic()):professionalRef.current;
    if(!value.messages.length&&value.phase==='idle')void run(undefined,mode);
  };
  const birthLabel = (chart: ZiweiChart) => { const birth = chart.birthInfo; return `${birth.year} 年 ${birth.month} 月 ${birth.day} 日 · ${['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'][birth.hour]}时 · ${birth.gender === 'male' ? '男' : '女'}${birth.city ? ` · ${birth.city}` : ''}`; };
  return <div className="comparison-session" data-ready={Boolean(charts)}>
    {!charts ? <>
      <div className="party-switch segmented" role="group" aria-label="填写双方资料">
        {['甲方', '乙方'].map((label, index) => <button key={label} type="button" aria-pressed={party === index} onClick={() => { setParty(index); setError(''); }}>{label}{(index ? formB : formA)?.name ? ' · ' + (index ? formB : formA)!.name : '资料'}</button>)}
      </div>
      <p className="muted">依次填写双方出生资料，生成后可跨设备继续查看。</p>
      <div className="heming-grid">
        {(['甲方', '乙方'] as const).map((label, index) => <section className="account-card party-form" data-active={party === index} key={label} aria-label={label + '命盘'}>
          <h2>{label}出生资料</h2><BirthForm hideSubmit draftKey={'pair-' + index} onSubmit={() => {}} onFormSave={index === 0 ? setFormA : setFormB} />
        </section>)}
      </div>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="pair-create-actions">
        {party === 0 ? <button className="btn-primary" type="button" onClick={() => {
          if (!formA || !validBirthDate(formA)) { setError('请先填写甲方的真实出生日期。'); return; }
          setParty(1); setError(''); document.querySelector('.party-switch')?.scrollIntoView({ block: 'start' });
        }}>下一步：乙方资料</button> : <><button type="button" className="small-button" onClick={() => setParty(0)}>返回甲方</button><button className="btn-primary" disabled={analyzing} onClick={() => void run()}>开始合盘分析</button></>}
      </div>
    </> : <>
      <div className="pair-summary">{charts.map((chart, index) => <div key={index}><strong>{index === 0 ? '甲方' : '乙方'} · {chart.birthInfo.name || '未命名'}</strong><span>{birthLabel(chart)}</span></div>)}</div>
      <div className="segmented pair-view-tabs" role="group" aria-label="合盘视图">
        <button type="button" aria-pressed={pairTab === 'analysis'} onClick={() => setPairTab('analysis')}>合盘解读</button>
        <button type="button" aria-pressed={pairTab === 'charts'} onClick={() => setPairTab('charts')}>双方命盘</button>
      </div>
      <div className="pair-chart-view" hidden={pairTab !== 'charts'}>
        <div className="segmented" role="group" aria-label="查看双方命盘">{['甲方', '乙方'].map((label, index) => <button key={label} type="button" aria-pressed={party === index} onClick={() => setParty(index)}>{label}命盘</button>)}</div>
        <ChartBoard key={party} chart={charts[party]} />
      </div>
      <section className="comparison-conversation" aria-label="合盘对话" hidden={pairTab !== 'analysis'}>
        <ReadingModeSwitch value={readingMode} onChange={selectMode} />
        {analyzing && <div className="generation-status"><span role="status">{status || '正在生成合盘解读…'}</span><button className="small-button" onClick={() => stopCurrent()}>停止生成</button></div>}
        <div key={readingMode} className="comparison-messages" data-reading-mode={readingMode} ref={reader.ref} onScroll={reader.onScroll} tabIndex={0} aria-label="合盘解读正文">
          {readingMode==='plain'&&<p className="reading-style-note">用日常语言解释双方的相处方式；已有专业内容会作为参考，生活例子仅帮助理解。</p>}
          {messages.map((message, index) => <article key={index} aria-label={message.role === 'user' ? '你的提问' : '合盘解读'}>
            <p className="message-label">{message.role === 'user' ? '你的提问' : readingMode==='plain'?'Codex 合盘 · 通俗解读':'Codex 合盘 · 专业解读'}</p>
            {message.role === 'user' ? <p className="user-question">{message.content}</p> : <>{index===firstAnswer&&<ReadingGuide chart={charts[0]} chartB={charts[1]} topic="overview" />}<ReadingText text={message.content} streaming={analyzing && index === messages.length - 1} /></>}
          </article>)}
          {!analyzing && ['interrupted', 'stopped', 'error'].includes(phase) && <div className="interrupted-notice" role="status"><p>上次解读未完成，已保留收到的文字。</p><button className="small-button" onClick={() => void run('请继续上次未完成的解读。')}>继续解读</button></div>}
          {error && <p role="alert" className="form-error">{error}</p>}
          <details className="pair-prompts"><summary>试试这些问题</summary>{['感情相处需要注意什么？', '适合合伙创业吗？', '双方如何沟通分歧？'].map(text => <button className="small-button" key={text} disabled={analyzing} onClick={() => void run(text)}>{text}</button>)}</details>
        </div>
        {reader.hasNew && <button type="button" className="new-content-button" onClick={reader.jump}><ArrowDown size={16} aria-hidden="true" />有新内容，回到底部</button>}
        <form className="pair-composer" onSubmit={event => { event.preventDefault(); if (question.trim()) void run(question); }}>
          <textarea rows={1} aria-label="合盘追问" value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (question.trim()) void run(question); } }} maxLength={12000} disabled={analyzing} placeholder="针对双方命盘继续提问…" />
          <button className="btn-primary send-button" aria-label="发送合盘追问" disabled={analyzing || !question.trim()}><Send size={19} aria-hidden="true" /></button>
        </form>
      </section>
    </>}
  </div>;
}
