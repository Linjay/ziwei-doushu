'use client';
import { useRef, useState, type ChangeEvent } from 'react';
import type { ChartHistory as History } from '@/lib/chart-history';
import { backupFilename, MAX_BACKUP_BYTES, type ImportSummary } from '@/lib/history-backup';
import { insightMessages } from '@/lib/insight-topics';

export default function ChartHistory({ history, storageError, syncState, onRetry, onSelect, onNew, onExport, onImport, newLabel = '← 新建命盘', disabled = false, compact = false }: {
  history: History;
  storageError: string;
  syncState?: string;
  onRetry?: () => Promise<void>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onExport: () => { json: string; count: number };
  onImport: (raw: string) => ImportSummary | Promise<ImportSummary>;
  newLabel?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [fileError, setFileError] = useState('');
  const buttonStyle = { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--bdr, #555)', background: 'transparent', cursor: 'pointer' } as const;
  const exportJson = () => {
    setNotice(''); setFileError('');
    try {
      const backup = onExport();
      const url = URL.createObjectURL(new Blob([backup.json], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = backupFilename();
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`已导出 ${backup.count} 条记录，JSON 文件已交给浏览器下载。`);
    } catch (error) { setFileError(error instanceof Error ? error.message : '导出失败，请重试。'); }
  };
  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const element = event.currentTarget;
    const file = element.files?.[0];
    if (!file) return;
    setBusy(true); setNotice(''); setFileError('');
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件超过 20 MB，无法导入。');
      const result = await onImport(await file.text());
      setNotice(`导入完成：新增 ${result.added} 条${result.conflicts ? `（含 ${result.conflicts} 条冲突副本）` : ''}，跳过 ${result.skipped} 条重复记录。`);
    } catch (error) { setFileError(error instanceof Error ? error.message : '导入失败，现有记录未改变。'); }
    finally { setBusy(false); element.value = ''; }
  };
  return (
    <section aria-label="账号历史记录" className={`history-toolbar ${compact ? 'backup-toolbar' : ''}`} style={{ marginBottom: 24, padding: 16, borderRadius: 12, border: '1px solid var(--bdr, #444)' }}>
      <details open={compact ? undefined : true}><summary>备份与恢复</summary>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {!compact && <><strong style={{ fontSize: 14 }}>我的历史（{history.records.length}）</strong><select
          aria-label="查看历史记录"
          value={history.activeId ?? ''}
          disabled={disabled || !history.records.length}
          onChange={event => { if (event.target.value) onSelect(event.target.value); }}
          style={{ flex: '1 1 240px', minWidth: 0, maxWidth: '100%', padding: '8px 10px', borderRadius: 8, color: 'var(--tx-1, #ddd)', background: 'var(--bg-card, #141820)', border: '1px solid var(--bdr, #555)' }}
        >
          <option value="">{history.records.length ? '选择之前的单盘或合盘' : '分析后自动保存'}</option>
          {history.records.map(record => (
            <option key={record.id} value={record.id}>
              {record.kind === 'comparison' ? '合盘' : '单盘'} · {record.label} · {new Date(record.createdAt).toLocaleString('zh-CN')} · {insightMessages(record.insight).filter(message => message.role === 'assistant' && message.content).length} 条解读
            </option>
          ))}
        </select></>}
        <button type="button" onClick={exportJson} disabled={busy || !history.records.length}
          style={{ ...buttonStyle, opacity: busy || !history.records.length ? 0.45 : 1 }}>导出 JSON</button>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={busy || disabled} style={buttonStyle}>
          {busy ? '正在导入…' : '导入 JSON'}
        </button>
        <input ref={fileInput} type="file" accept=".json,application/json" aria-label="选择历史备份 JSON" hidden onChange={importJson} />
        {!compact && history.activeId && (
          <button type="button" onClick={onNew} disabled={disabled} style={buttonStyle}>
            {newLabel}
          </button>
        )}
      </div>
      <p role="status" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--tx-2, #999)' }}>{syncState || '命盘与解读自动保存到账户，登录后可跨设备查看。'}</p>
      {notice && <p role="status" style={{ margin: '8px 0 0', fontSize: 12 }}>{notice}</p>}
      {fileError && <p role="alert" style={{ margin: '8px 0 0', fontSize: 12, color: '#e9a654' }}>{fileError}</p>}
      {storageError && <p role="alert" style={{ margin: '8px 0 0', fontSize: 12, color: '#e9a654' }}>{storageError}</p>}
      {storageError && onRetry && <button type="button" className="text-button" onClick={() => { void onRetry().catch(() => {}); }}>重新同步</button>}
      </details>
    </section>
  );
}
