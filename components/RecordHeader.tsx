'use client';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
export default function RecordHeader({ title, syncState, error, onRetry, onNew, newLabel = '新建', disabled = false }: {
  title: string; syncState: string; error?: string; onRetry?: () => Promise<void>;
  onNew: () => void; newLabel?: string; disabled?: boolean;
}) {
  return <div className="record-header-wrap"><div className="record-header">
    <Link href="/history" className="icon-button" aria-label="返回历史记录"><ArrowLeft aria-hidden="true" size={22} /></Link>
    <div className="record-heading"><h1>{title}</h1><span role="status" className="sync-caption">{syncState}</span></div>
    <button type="button" className="small-button" onClick={onNew} disabled={disabled}><Plus size={18} aria-hidden="true" />{newLabel}</button>
  </div>{error && <div role="alert" className="sync-error">{error}{onRetry && <button type="button" onClick={() => void onRetry().catch(() => {})}>重新同步</button>}</div>}</div>;
}
