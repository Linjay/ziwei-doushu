'use client';
import { useState, useRef, useEffect } from 'react';
import ReadingText from './ReadingText';
import ReadingModeSwitch from './ReadingModeSwitch';
import ReadingGuide from './ReadingGuide';
import { TOPIC_ICONS } from './TopicIcons';
import { professionalReference, readingKey as modeKey, type ReadingMode } from '@/lib/reading-modes';
import { useReadingScroll } from '@/lib/use-reading-scroll';
import { ArrowDown, Send } from 'lucide-react';
import { useAccountDraft } from '@/lib/use-account-draft';
import { useAccount } from './AccountProvider';
import { motion, AnimatePresence } from 'framer-motion';
import type { ZiweiChart, Palace } from '@/lib/ziwei/types';
import type { TimeView } from './TimeNav';
import { readAIStream } from '@/lib/ai-stream';
import { emptyInsight, type InsightMessage, type InsightPhase, type SavedInsight } from '@/lib/chart-history';
import { INSIGHT_TOPICS, emptyTopic, insightMessages, isInsightTopic, mergeTopics, projectInsight, topicConversations, type InsightTopic, type TopicConversations } from '@/lib/insight-topics';

type Message = InsightMessage;
function restoreDrafts(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([key, text]) => (isInsightTopic(key) || /^(professional|plain):(overview|love|career|wealth|health|personality)$/.test(key)) && typeof text === 'string' && text.length <= 12000));
}

interface SelectedSiHua {
  starName: string;
  siHua: string;
  view: TimeView;
}

interface InsightPanelProps {
  readingKey?: string;
  chart: ZiweiChart;
  selectedPalace?: Palace | null;
  selectedSiHua?: SelectedSiHua | null;
  initialState?: SavedInsight;
  autoInterpret?: boolean;
  onStateChange?: (insight: SavedInsight, immediate?: boolean) => void;
}

const TOPICS = [
  { key: 'overview',     label: '命格' },
  { key: 'love',        label: '感情' },
  { key: 'career',      label: '事业' },
  { key: 'wealth',      label: '财运' },
  { key: 'health',      label: '健康' },
  { key: 'personality', label: '性格' },
] as const;

const TOPIC_PROMPTS: Record<string, string> = {
  overview: `请生成命格总览，按以下结构输出：

**【命格定性】**
用一句话概括这个命盘的核心格局与命主气质。

**【主星解读】**
命宫主星的核心特质，引用倪海厦原话或观点。

**【三方四正】**
财、官、迁三宫的联动分析及整体格局。

**【当前大限】**
当下大限运势方向与最值得关注的事项。

**【优势与注意】**
命盘天赋优势，以及需要注意的风险或功课。`,

  love: `请深度分析感情婚姻运，按以下结构输出：

**【感情格局】**
一句话定性感情命格。

**【夫妻宫分析】**
夫妻宫主星、四化，以及倪海厦体系的具体解读。

**【三方联动】**
相关宫位对感情的影响。

**【当前大限感情运】**
当下10年感情走向与关键节点。

**【实际建议】**
具体可行的感情建议。`,

  career: `请深度分析事业运，按以下结构输出：

**【事业格局】**
一句话定性事业命格，宜任职或宜创业。

**【官禄宫分析】**
官禄宫主星、四化，以及倪师对这种配置的判断。

**【财帛宫联动】**
财运与事业的关系，财路来源分析。

**【当前大限事业运】**
当下10年事业走向。

**【实际建议】**
适合的方向、行业与策略。`,

  wealth: `请深度分析财运，按以下结构输出：

**【财运格局】**
一句话定性财运模式，是主动财还是被动财。

**【财帛宫分析】**
财帛宫主星、四化，财富来源与流动模式。

**【田宅宫（财库）】**
积蓄能力与不动产运势分析。

**【当前大限财运】**
当下财运走向与注意事项。

**【理财建议】**
具体的财务建议。`,

  health: `请分析健康运势，按以下结构输出：

**【疾厄宫主星】**
疾厄宫星曜与健康含义。

**【主要风险】**
结合倪海厦子午流注理论，分析主要健康隐患与需关注的部位。

**【大限健康走势】**
当下健康趋势与关键时间段。

**【预防建议】**
具体注意事项与养生方向。`,

  personality: `请深度解析性格特质，按以下结构输出：

**【命宫主星性格】**
命宫主星的核心性格特质，引用倪师原话。

**【三方性格综合】**
财、官、迁三宫对性格的影响，全貌描绘。

**【人际关系模式】**
与他人互动方式、待人处世风格。

**【优势与人生课题】**
天赋优势，以及需要面对的人生功课。`,
};

const PALACE_ROLES: Record<string, string> = {
  '命宫':   '自我、性格、先天格局',
  '兄弟宫': '兄弟关系、合伙人',
  '夫妻宫': '感情关系、婚姻状态',
  '子女宫': '子女缘分、下属关系',
  '财帛宫': '财运来源、收入方式',
  '疾厄宫': '身体健康、意外',
  '迁移宫': '外出机遇、人际格局',
  '交友宫': '朋友圈、贵人、小人',
  '官禄宫': '事业成就、社会地位',
  '田宅宫': '不动产、家庭环境',
  '福德宫': '精神享受、内心福分',
  '父母宫': '父母关系、文书契约',
};


export default function InsightPanel({ chart, selectedPalace, selectedSiHua, initialState, autoInterpret = true, onStateChange, readingKey = 'chart' }: InsightPanelProps) {
  const { user } = useAccount();
  const initial = initialState ?? emptyInsight();
  const initialTopic = isInsightTopic(initial.activeTopic) ? initial.activeTopic : 'overview';
  const [conversations, setConversations] = useState<TopicConversations>(() => topicConversations(initial));
  const conversationsRef = useRef(conversations);
  const [plainConversations,setPlainConversations]=useState<TopicConversations>(initial.plainTopics||{});
  const plainRef=useRef(plainConversations);
  const [readingMode,setReadingMode]=useState<ReadingMode>(initial.readingMode||'professional');
  const modeRef=useRef(readingMode);const hasModes=useRef(initial.plainTopics!==undefined);
  const [activeTopic, setActiveTopic] = useState<InsightTopic>(initialTopic);
  const topicRef = useRef<InsightTopic>(initialTopic);
  const [drafts, setDrafts] = useAccountDraft(`insight_${readingKey}`, {}, restoreDrafts);
  const [runningTopic, setRunningTopic] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const requestRef = useRef<{ topic: InsightTopic; mode:ReadingMode; controller: AbortController } | null>(null);
  const leavingRef = useRef(false);
  const onStateChangeRef = useRef(onStateChange); onStateChangeRef.current = onStateChange;
  const autoLoaded = useRef(!autoInterpret || insightMessages(initial).length > 0 || initial.phase !== 'idle');
  const lastPalaceBranch = useRef<number | undefined>(undefined);
  const lastSiHuaKey = useRef<string | undefined>(undefined);
  const current = (readingMode==='plain'?plainConversations:conversations)[activeTopic] || emptyTopic();
  const messages = current.messages; const phase = current.phase;
  const viewKey=modeKey(readingMode,activeTopic);
  const loading = runningTopic === viewKey;
  const reader = useReadingScroll(viewKey, messages, loading, `mingli_draft_${user?.id}_scroll_${readingKey}`);
  const input = drafts[viewKey] ?? (readingMode==='professional'?drafts[activeTopic]:'') ?? '';
  const topicLabel = TOPICS.find(topic => topic.key === activeTopic)!.label;
  const firstAnswer = messages.findIndex(message=>message.role==='assistant'&&message.content.trim());
  const setInput = (value: string) => setDrafts(previous => ({ ...previous, [modeKey(modeRef.current,topicRef.current)]: value }));
  const persist = (immediate = false) => onStateChangeRef.current?.(projectInsight(conversationsRef.current, topicRef.current,hasModes.current?{plainTopics:plainRef.current,readingMode:modeRef.current}:undefined), immediate);
  const changeTopic = (topic: InsightTopic, nextMessages: Message[], nextPhase: InsightPhase, immediate = false,mode:ReadingMode=modeRef.current) => {
    const target=mode==='plain'?plainRef:conversationsRef;
    const previous = target.current[topic] || emptyTopic();
    target.current = { ...target.current, [topic]: {
      messages: nextMessages, phase: nextPhase, updatedAt: Math.max(Date.now(), previous.updatedAt + 1),
    } };
    if (!leavingRef.current) (mode==='plain'?setPlainConversations:setConversations)(target.current);
    persist(immediate);
  };
  const stopCurrent = (nextPhase: InsightPhase = 'stopped') => {
    const request = requestRef.current; if (!request) return;
    requestRef.current = null;
    const previous = (request.mode==='plain'?plainRef:conversationsRef).current[request.topic] || emptyTopic();
    changeTopic(request.topic, previous.messages.filter(message => message.role !== 'assistant' || message.content.length > 0), nextPhase, true,request.mode);
    request.controller.abort();
    if (!leavingRef.current) { setRunningTopic(null); setStatus(''); }
  };
  const activate = (topic: InsightTopic,mode:ReadingMode=modeRef.current) => {
    if (topicRef.current === topic && modeRef.current===mode) return;
    stopCurrent('interrupted');
    topicRef.current = topic;modeRef.current=mode;setReadingMode(mode);if(mode==='plain')hasModes.current=true; setActiveTopic(topic); persist(true);
  };
  const promptFor=(topic:InsightTopic,mode:ReadingMode)=>mode==='plain'?`请用通俗语言解读【${TOPICS.find(item=>item.key===topic)!.label}】主题，结合已保存的专业内容解释术语、举生活例子并给出温和可行的建议。`:TOPIC_PROMPTS[topic];
  const sendMessage = async (text: string, hidden = false, topic: InsightTopic = topicRef.current,mode:ReadingMode=modeRef.current) => {
    if (!text.trim() || leavingRef.current) return;
    if (requestRef.current?.topic === topic && requestRef.current.mode===mode) return;
    activate(topic,mode);
    reader.startFollowing(modeKey(mode,topic));
    const prior = [...((mode==='plain'?plainRef:conversationsRef).current[topic]?.messages || []), { role: 'user' as const, content: text, hidden }];
    const request = { topic,mode, controller: new AbortController() }; requestRef.current = request;
    setRunningTopic(modeKey(mode,topic)); setStatus(mode==='plain'?'正在把专业内容解释得更易懂…':'Codex 正在解读命盘…');
    setDrafts(previous => ({ ...previous, [modeKey(mode,topic)]: '',...(mode==='professional'?{[topic]:''}:{}) }));
    changeTopic(topic, [...prior, { role: 'assistant', content: '' }], 'running', true,mode);
    let assistantText = '';
    try {
      const response = await fetch('/api/interpret', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chart,readingMode:mode,professionalReference:mode==='plain'?professionalReference(conversationsRef.current[topic]?.messages||[],conversationsRef.current[topic]?.phase||'idle'):undefined, messages: prior.slice(-20).map(({ role, content }) => ({ role, content })) }), signal: request.controller.signal });
      await readAIStream(response, text => {
        if (requestRef.current !== request || leavingRef.current) return;
        assistantText = text;
        changeTopic(topic, [...prior, { role: 'assistant', content: text }], 'running',false,mode);
      }, value => { if (requestRef.current === request && !leavingRef.current) setStatus(value); });
      if (requestRef.current === request && !leavingRef.current) changeTopic(topic, [...prior, { role: 'assistant', content: assistantText }], 'complete', true,mode);
    } catch (error) {
      if (requestRef.current !== request || leavingRef.current) return;
      const disconnected = error instanceof TypeError || (error instanceof Error && /连接中断|network|failed to fetch/i.test(error.message));
      const message = disconnected ? '连接中断，已保留收到的内容。' : error instanceof Error ? error.message : '解读失败，请稍后重试。';
      changeTopic(topic, [...prior, { role: 'assistant', content: assistantText ? `${assistantText}\n\n${message}` : message }], disconnected ? 'interrupted' : 'error', true,mode);
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        if (!leavingRef.current) { setRunningTopic(null); setStatus(''); }
      }
    }
  };
  const handleTopicClick = (key: string) => {
    if (!isInsightTopic(key)) return;
    activate(key);
    const conversation = (modeRef.current==='plain'?plainRef:conversationsRef).current[key] || emptyTopic();
    if (!conversation.messages.length && conversation.phase === 'idle') void sendMessage(promptFor(key,modeRef.current), true, key);
  };
  const handleModeClick=(mode:ReadingMode)=>{activate(topicRef.current,mode);const item=(mode==='plain'?plainRef:conversationsRef).current[topicRef.current]||emptyTopic();if(!item.messages.length&&item.phase==='idle')void sendMessage(promptFor(topicRef.current,mode),true,topicRef.current,mode);};
  const handleSend = () => { void sendMessage(input); };
  const topicForPalace = (name: string): InsightTopic => {
    if (/夫妻/.test(name)) return 'love';
    if (/官禄/.test(name)) return 'career';
    if (/财帛|田宅/.test(name)) return 'wealth';
    if (/疾厄/.test(name)) return 'health';
    if (/福德/.test(name)) return 'personality';
    if (/命宫/.test(name)) return 'overview';
    return topicRef.current;
  };
  useEffect(() => {
    if (!initialState) return;
    const incoming = topicConversations(initialState);
    if(initialState.plainTopics!==undefined)hasModes.current=true;
    const plain=mergeTopics(plainRef.current,initialState.plainTopics||{});
    if(INSIGHT_TOPICS.some(key=>plain[key]!==plainRef.current[key])){plainRef.current=plain;setPlainConversations(plain);}
    const merged = mergeTopics(conversationsRef.current, incoming);
    if (INSIGHT_TOPICS.some(key => merged[key] !== conversationsRef.current[key])) {
      conversationsRef.current = merged; setConversations(merged);
    }
  }, [initialState]);
  useEffect(() => {
    leavingRef.current = false;
    const leave = () => { leavingRef.current = true; stopCurrent('interrupted'); };
    const show = () => { if (!leavingRef.current) return; leavingRef.current = false; setConversations(conversationsRef.current);setPlainConversations(plainRef.current); setRunningTopic(null); setStatus(''); };
    window.addEventListener('beforeunload', leave); window.addEventListener('pagehide', leave); window.addEventListener('pageshow', show);
    const timer = setTimeout(() => {
      if (initialState && initialState.topics === undefined && initialState.messages.length) persist(true);
      if (autoLoaded.current) return;
      autoLoaded.current = true; void sendMessage(TOPIC_PROMPTS.overview, true, 'overview');
    }, 0);
    return () => {
      clearTimeout(timer); window.removeEventListener('beforeunload', leave); window.removeEventListener('pagehide', leave); window.removeEventListener('pageshow', show); leave();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Inject palace analysis when palace selected
  useEffect(() => {
    if (!selectedPalace || selectedPalace.branch === lastPalaceBranch.current) return;
    lastPalaceBranch.current = selectedPalace.branch;

    const majorStars = selectedPalace.stars.filter(s => s.type === 'major');
    const starDesc = majorStars.length > 0
      ? majorStars.map(s => `${s.name}${s.siHua ? '化' + s.siHua : ''}`).join('、')
      : '空宫（借对宫）';
    const role = PALACE_ROLES[selectedPalace.name] ?? '';

    const prompt = `请重点分析【${selectedPalace.name}】（主管：${role}），该宫主星为${starDesc}，按以下结构输出：

**【宫位定性】**
${selectedPalace.name}在命盘中的意义，以及这种星曜配置的整体判断。

**【主星解读】**
主星在此宫的倪海厦体系解读，引用具体观点。

**【三方四正联动】**
三方四正宫位对此宫的影响。

**【实际建议】**
基于此宫的具体建议。`;

    void sendMessage(prompt, true, topicForPalace(selectedPalace.name));
  }, [selectedPalace]); // eslint-disable-line react-hooks/exhaustive-deps

  // 注入四化飞化分析
  useEffect(() => {
    if (!selectedSiHua) return;
    const key = `${selectedSiHua.starName}-${selectedSiHua.siHua}-${selectedSiHua.view}`;
    if (key === lastSiHuaKey.current) return;
    lastSiHuaKey.current = key;

    // 找出该星所在宫位
    const palaceOfStar = chart.palaces.find(p =>
      p.stars.some(s => s.name === selectedSiHua.starName)
    );
    const palaceName = palaceOfStar?.name ?? '未知宫位';
    const viewLabel = selectedSiHua.view === 'daxian' ? '大限' : '流年';

    const prompt = `请分析【${viewLabel}${selectedSiHua.starName}化${selectedSiHua.siHua}】的飞化影响，按以下结构输出：

**【化${selectedSiHua.siHua}基本含义】**
化${selectedSiHua.siHua}在倪海厦体系中的核心含义，以及${selectedSiHua.starName}化${selectedSiHua.siHua}的特殊含义。

**【落宫影响】**
${selectedSiHua.starName}化${selectedSiHua.siHua}落在【${palaceName}】，该宫主管的领域受到何种影响，倪师如何解读。

**【三方四正飞化路径】**
化${selectedSiHua.siHua}入${palaceName}后，对其三方四正（对宫、两个三合宫）的联动影响。

**【当前运势影响】**
在${viewLabel}时间维度下，此化${selectedSiHua.siHua}对命主近期运势的具体影响。

**【实际建议】**
基于此四化的具体可操作建议。`;

    void sendMessage(prompt, true, topicForPalace(palaceName));
  }, [selectedSiHua]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="insight-panel flex flex-col h-full rounded-xl overflow-hidden card-glass">

      {/* ── Topic buttons ── */}
      <div className="insight-controls flex-shrink-0" style={{ borderBottom: '1px solid var(--t-border)' }}>
        <div className="insight-topics" role="tablist" aria-label="AI 解读主题">
          {TOPICS.map(t => {
            const isActive = activeTopic === t.key;
            const Icon = TOPIC_ICONS[t.key];
            return (
              <button
                key={t.key}
                onClick={() => handleTopicClick(t.key)}
                type="button" role="tab" id={`insight-tab-${t.key}`} aria-selected={isActive} aria-controls={`insight-panel-${t.key}`}
                tabIndex={isActive ? 0 : -1}
                onKeyDown={event => {
                  const index = TOPICS.findIndex(topic => topic.key === t.key);
                  const next = event.key === 'ArrowRight' ? (index + 1) % TOPICS.length : event.key === 'ArrowLeft' ? (index + TOPICS.length - 1) % TOPICS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TOPICS.length - 1 : -1;
                  if (next >= 0) { event.preventDefault(); document.getElementById(`insight-tab-${TOPICS[next].key}`)?.focus(); }
                }}
                className="insight-topic font-medium rounded-lg transition-all duration-150"
                style={{
                  background: isActive ? 'rgba(212,168,67,0.12)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(212,168,67,0.3)' : 'var(--t-border)'}`,
                  color: isActive ? 'var(--t-gold)' : 'var(--t-faint)',
                }}
              >
                <Icon size={20} aria-hidden="true" /><span>{t.label}</span>
              </button>
            );
          })}
        </div>
        <div className="insight-mode-row"><span>阅读方式</span><ReadingModeSwitch value={readingMode} onChange={handleModeClick} /></div>
      </div>

      {loading && (
        <div role="status" className="flex items-center justify-between px-3 py-2 text-[11px]" style={{ color: 'var(--t-gold)' }}>
          <span>{status}</span>
          <button type="button" onClick={() => stopCurrent()} className="rounded px-2 py-1" style={{ border: '1px solid var(--t-border)' }}>停止</button>
        </div>
      )}

      {/* ── Messages ── */}
      <div key={viewKey} data-reading-mode={readingMode} ref={reader.ref} onScroll={reader.onScroll} role="tabpanel" tabIndex={0} id={`insight-panel-${activeTopic}`} aria-labelledby={`insight-tab-${activeTopic}`} className="insight-messages flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {readingMode==='plain'&&<p className="reading-style-note">用日常语言解释本主题；已有专业内容会作为参考，生活例子仅帮助理解。</p>}

        {['interrupted', 'stopped', 'error'].includes(phase) && (
          <p role="status" className="interrupted-notice">{phase === 'stopped' ? '已停止生成' : phase === 'error' ? '上次解读遇到错误' : '上次解读未完成'}，已保留收到的内容。你可以继续提问或重新生成。</p>
        )}
        {!loading && ['interrupted', 'stopped', 'error'].includes(phase) && <button type="button" className="small-button" onClick={() => void sendMessage(promptFor(activeTopic,readingMode), true)}>重新生成{topicLabel}解读</button>}

        {/* Loading state before first message */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl mb-3" style={{ color: 'var(--t-gold)', opacity: 0.1 }}>✦</div>
            <p className="text-[10px]" style={{ color: 'var(--t-faint)' }}>{loading ? `${topicLabel}解读生成中…` : `选择${topicLabel}主题或输入问题开始解读。`}</p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg, i) => {
            if (msg.role === 'user' && msg.hidden) return null;

            if (msg.role === 'user') {
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-end"
                >
                  <div
                    className="max-w-[85%] rounded-xl px-3 py-2 text-[11px]"
                    style={{
                      background: 'rgba(212,168,67,0.08)',
                      border: '1px solid rgba(212,168,67,0.18)',
                      color: 'var(--t-gold)',
                    }}
                  >
                    {msg.content}
                  </div>
                </motion.div>
              );
            }

            // Assistant message
            const isLastMsg = i === messages.length - 1;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div
                  className="text-[9px] tracking-widest mb-2 flex items-center gap-1.5"
                  style={{ color: 'var(--t-faint)' }}
                >
                  <span style={{ color: 'var(--t-gold)', opacity: 0.4 }}>✦</span>
                  Codex · {readingMode==='plain'?'通俗解读':'专业解读'}
                </div>
                {i===firstAnswer&&<ReadingGuide chart={chart} topic={activeTopic} />}
                <ReadingText text={msg.content} streaming={loading && isLastMsg} />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* ── Input ── */}
      {reader.hasNew && <button type="button" className="new-content-button" onClick={reader.jump}><ArrowDown size={16} aria-hidden="true" />有新内容，回到底部</button>}
      <div className="insight-composer flex-shrink-0 px-3 pb-3 pt-2" style={{ borderTop: '1px solid var(--t-border)' }}>
        <div className="flex gap-2">
          <textarea
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend(); } }}
            aria-label={`${topicLabel}追问`} placeholder={`继续追问${topicLabel}相关问题…`}
            disabled={loading}
            className="flex-1 rounded-lg px-3 py-2 focus:outline-none transition-colors"
            style={{
              background: 'var(--t-card)',
              border: '1px solid var(--t-border)',
              color: 'var(--t-text)',
            }}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="send-button px-3 py-2 rounded-lg font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="发送追问"
            style={{
              background: 'rgba(212,168,67,0.15)',
              border: '1px solid rgba(212,168,67,0.25)',
              color: 'var(--t-gold)',
            }}
          >
            <Send size={19} aria-hidden="true" />
          </button>
        </div>
      </div>

    </div>
  );
}
