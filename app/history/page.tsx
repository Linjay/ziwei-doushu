'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AccountGuard } from '@/components/AccountProvider';
import ChartHistory from '@/components/ChartHistory';
import { useChartHistory } from '@/lib/use-chart-history';
import { useRouter } from 'next/navigation';
import { CHART_HISTORY_KEY, decodeHistory, isComparisonRecord, recordHref } from '@/lib/chart-history';
import { serializeHistoryBackup } from '@/lib/history-backup';
import { insightMessages } from '@/lib/insight-topics';

export default function HistoryPage() { return <AccountGuard><HistoryContent /></AccountGuard>; }
function HistoryContent() {
  const store = useChartHistory(); const router = useRouter();
  const [query, setQuery] = useState(''); const [notice, setNotice] = useState('');
  const [kind, setKind] = useState('all');
  const [editing, setEditing] = useState<string | null>(null); const [label, setLabel] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [legacyCount, setLegacyCount] = useState(0); const [legacyBusy, setLegacyBusy] = useState(false);
  useEffect(() => { try { setLegacyCount(decodeHistory(localStorage.getItem(CHART_HISTORY_KEY)).records.length); } catch {} }, []);
  const importLegacy = async () => {
    setLegacyBusy(true); setNotice('');
    try {
      const raw = serializeHistoryBackup(decodeHistory(localStorage.getItem(CHART_HISTORY_KEY)));
      const result = await store.importBackup(raw);
      setNotice(`已导入 ${result.added} 条旧版记录，跳过 ${result.skipped} 条重复记录。原始浏览器记录仍保留。`); setLegacyCount(0);
    } catch (error) { setNotice(error instanceof Error ? error.message : '旧记录导入失败。'); }
    finally { setLegacyBusy(false); }
  };
  const records = store.history.records.filter(record => {
    const compare = isComparisonRecord(record);
    if (kind !== 'all' && kind !== (compare ? 'comparison' : 'single')) return false;
    const births = [record.chart.birthInfo, ...(compare ? [record.chartB.birthInfo] : [])];
    return `${record.label} ${births.map(b => `${b.name || ''} ${b.year}-${b.month}-${b.day} ${b.city || ''}`).join(' ')}`.toLowerCase().includes(query.toLowerCase());
  });
  const remove = async (id: string) => {
    setBusy(true); setNotice('');
    try { await store.remove(id); setDeleting(null); setNotice('记录及其全部解读已删除。'); }
    catch (error) { setNotice(error instanceof Error ? error.message : '删除失败。'); }
    finally { setBusy(false); }
  };
  return <main className="account-shell history-page">
    <div className="page-heading"><div><h1>历史记录</h1><p className="muted">{store.history.records.length} 份单盘与合盘 · 按账号保存</p></div><div className="record-actions"><Link href="/chart?new=1" className="small-button">新建命盘</Link><Link href="/heming?new=1" className="small-button">新建合盘</Link></div></div>
    <ChartHistory compact history={store.history} storageError={store.storageError} syncState={store.syncState} onRetry={store.retrySync}
      onSelect={id => { const record = store.history.records.find(record => record.id === id); if (record) router.push(recordHref(record)); }} onNew={() => { store.select(null); router.push('/chart'); }} onExport={store.exportBackup} onImport={store.importBackup} />
    {legacyCount > 0 && <section className="account-card"><p className="muted">此浏览器保留了 {legacyCount} 条旧版记录。确认属于本人后，可导入当前账号。</p><button className="small-button" disabled={legacyBusy || !store.ready} onClick={() => void importLegacy()}>{legacyBusy ? '正在导入…' : '导入旧浏览器记录'}</button></section>}
    {store.history.records.length > 0 && <div className="history-filters"><label className="history-search">搜索记录<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="姓名、日期或记录名" /></label><div className="segmented" role="group" aria-label="历史类型">{[['all', '全部'], ['single', '单盘'], ['comparison', '合盘']].map(([key, title]) => <button key={key} type="button" aria-pressed={kind === key} onClick={() => setKind(key)}>{title}</button>)}</div></div>}
    {notice && <p role="status" className="app-message">{notice}</p>}
    {!store.ready ? <p role="status">正在读取历史…</p> : !records.length ? <section className="account-card empty-state"><h2>{query || kind !== 'all' ? '没有匹配的记录' : '还没有保存的记录'}</h2><p className="muted">{query || kind !== 'all' ? '试试其他关键词或类型。' : '新建单盘或合盘，也可用上方“导入 JSON”恢复备份。'}</p><Link href="/chart" className="small-button">开始排盘</Link></section> : <div className="record-grid">{records.map(record => {
      const birth = record.chart.birthInfo;
      const compare = isComparisonRecord(record);
      const answers = insightMessages(record.insight).filter(message => message.role === 'assistant' && message.content);
      const excerpt = record.insight.messages.filter(message => message.role === 'assistant' && message.content).at(-1) || answers.at(-1);
      return <article className="account-card record-card" key={record.id}>
        <div className="record-topline"><span className="record-badge">{compare ? '双人合盘' : birth.gender === 'male' ? '单盘 · 男' : '单盘 · 女'}</span><time>{new Date(record.createdAt).toLocaleDateString('zh-CN')}</time></div>
        {editing === record.id ? <form className="rename-form" onSubmit={event => { event.preventDefault(); if (label.trim()) { store.rename(record.id, label); setEditing(null); } }}><input aria-label="命盘名称" value={label} onChange={event => setLabel(event.target.value)} maxLength={200} required autoFocus /><button className="small-button">保存名称</button><button type="button" className="text-button" onClick={() => setEditing(null)}>取消</button></form> : <h2>{record.label}</h2>}
        <p className="muted">{compare ? '甲方：' : ''}{birth.name ? `${birth.name} · ` : ''}{birth.year} 年 {birth.month} 月 {birth.day} 日 · {birth.city || birth.province || '未填出生地'}</p>
        {compare && <p className="muted">乙方：{record.chartB.birthInfo.name ? `${record.chartB.birthInfo.name} · ` : ''}{record.chartB.birthInfo.year} 年 {record.chartB.birthInfo.month} 月 {record.chartB.birthInfo.day} 日 · {record.chartB.birthInfo.city || record.chartB.birthInfo.province || '未填出生地'}</p>}
        <p className="record-excerpt">{excerpt?.content.replace(/[#*`]/g, '').slice(0, 100) || '已保存命盘，打开后可开始 AI 解读。'}</p>
        <p className="muted">{answers.length} 条解读 · 更新于 {new Date(record.updatedAt).toLocaleString('zh-CN')}</p>
        <div className="record-actions"><Link href={recordHref(record)} className="small-button">{compare ? '查看合盘与解读' : '查看命盘与解读'}</Link><button className="text-button" onClick={() => { setEditing(record.id); setLabel(record.label); }}>重命名</button><button className="text-button danger" onClick={() => setDeleting(record.id)}>删除</button></div>
        {deleting === record.id && <div className="delete-confirm" role="alert"><p>确认删除这份{compare ? '合盘、双方命盘' : '命盘'}和全部解读？建议先导出 JSON 备份。</p><button className="small-button danger" disabled={busy} onClick={() => void remove(record.id)}>{busy ? '删除中…' : '确认删除'}</button><button className="text-button" onClick={() => setDeleting(null)}>取消</button></div>}
      </article>;
    })}</div>}
  </main>;
}
