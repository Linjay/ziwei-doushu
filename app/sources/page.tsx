'use client';
import { useEffect, useState } from 'react';
import { AccountGuard } from '@/components/AccountProvider';
import ReadingText from '@/components/ReadingText';
import { safeReturnPath } from '@/lib/navigation';
import Link from 'next/link';

type Source = { title: string; text: string; locator: string; license: string; url: string; id: string };
export default function SourcesPage() {
  return <AccountGuard><SourceContent /></AccountGuard>;
}
function SourceContent() {
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState('');
  const [returnTo, setReturnTo] = useState('/history');
  useEffect(() => {
    const ref = new URLSearchParams(location.search).get('ref');
    const back = new URLSearchParams(location.search).get('returnTo');
    if (back) setReturnTo(safeReturnPath(back));
    if (!ref) { setError('请从 AI 解读末尾的资料链接打开具体条目。'); return; }
    const controller = new AbortController();
    fetch(`/api/knowledge?ref=${encodeURIComponent(ref)}`, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || '资料读取失败');
      setSource(data);
    }).catch(error => { if (error.name !== 'AbortError') setError(error.message); });
    return () => controller.abort();
  }, []);
  return <main className="account-shell source-page"><Link href={returnTo} className="small-button">返回解读 / 历史</Link><article className="account-card account-form" style={{ overflowWrap: 'anywhere', marginTop: 16 }}>
    <h1 style={{ fontSize: 24, fontWeight: 700 }}>{source?.title || '解读参考资料'}</h1>
    {error && <p role="alert">{error}</p>}
    {!source && !error && <p>正在读取资料…</p>}
    {source && <>
      <p className="source-metadata">{source.locator} · {source.id}</p>
      <details className="source-license"><summary>来源与使用许可</summary><p>{source.license}</p><p className="muted">来源：王多鱼AI / Renhuai123/ziwei-doushu。此页显示原始条目；检索时可能只提供相关节选。旧版规则、年龄和亮度可能与当前命盘不同，请以当前排盘为准。</p></details>
      <ReadingText text={source.text} />
      {(source.url.startsWith('/library/') || source.url.startsWith('https://www.bilibili.com/video/')) && <a href={source.url} target="_blank" rel="noreferrer">查看原文位置 / 视频时间码</a>}
      <a href="https://github.com/Renhuai123/ziwei-doushu" target="_blank" rel="noreferrer">上游项目与许可</a>
    </>}
    <Link href={returnTo}>返回解读 / 历史</Link>
  </article></main>;
}
