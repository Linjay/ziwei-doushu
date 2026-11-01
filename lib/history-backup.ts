import { decodeHistory, isComparisonRecord, newRecordId, type ChartHistory, type ChartRecord } from './chart-history';
import { insightContent } from './insight-topics';

export const BACKUP_FORMAT = 'ziwei-chart-history';
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export function serializeHistoryBackup(history: ChartHistory, now = new Date()): string {
  return JSON.stringify({ format: BACKUP_FORMAT, exportedAt: now.toISOString(), ...history,
    version: history.records.some(record => record.insight.plainTopics !== undefined) ? 4 : history.records.some(record => record.insight.topics !== undefined) ? 3 : history.records.some(isComparisonRecord) ? 2 : 1 }, null, 2) + '\n';
}

export function backupFilename(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)?.value;
  return `ziwei-history-${part('year')}${part('month')}${part('day')}-${part('hour')}${part('minute')}${part('second')}.json`;
}

export function parseHistoryBackup(raw: string): ChartHistory {
  if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) throw new Error('备份文件超过 20 MB，无法导入。');
  let value: unknown;
  try { value = JSON.parse(raw.replace(/^\uFEFF/, '')); }
  catch { throw new Error('文件不是有效的 JSON 备份，现有记录未改变。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('文件不是命盘历史备份。');
  const metadata = value as Record<string, unknown>;
  if (metadata.format !== undefined && metadata.format !== BACKUP_FORMAT) throw new Error('不支持此备份文件格式。');
  if (![1, 2, 3, 4].includes(metadata.version as number)) throw new Error('不支持此备份版本，请使用版本 1、2、3 或 4 的历史备份。');
  if (metadata.exportedAt !== undefined && (typeof metadata.exportedAt !== 'string' || !Number.isFinite(Date.parse(metadata.exportedAt)))) {
    throw new Error('备份的导出时间不正确。');
  }
  try { return decodeHistory(JSON.stringify({ ...metadata, version: 1 })); }
  catch { throw new Error('备份中的命盘或对话格式不正确，现有记录未改变。'); }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).filter(key => item[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
function signature(record: ChartRecord) {
  return canonical({ kind: record.kind || 'single', label: record.label, chart: record.chart,
    chartB: isComparisonRecord(record) ? record.chartB : undefined,
    insight: insightContent(record.insight,isComparisonRecord(record)), createdAt: record.createdAt });
}

export interface ImportSummary { added: number; skipped: number; conflicts: number }
export function mergeHistoryBackup(
  current: ChartHistory, incoming: ChartHistory, newId: () => string = newRecordId,
): { history: ChartHistory; summary: ImportSummary } {
  const records = new Map(current.records.map(record => [record.id, record]));
  const signatures = new Map(current.records.map(record => [signature(record), record.id]));
  const restoredIds = new Map<string, string>();
  const summary: ImportSummary = { added: 0, skipped: 0, conflicts: 0 };
  for (const record of incoming.records) {
    const existing = records.get(record.id);
    let id = record.id;
    if (existing) {
      const incomingSignature = signature(record);
      const duplicate = signatures.get(incomingSignature);
      if (duplicate) { restoredIds.set(record.id, duplicate); summary.skipped++; continue; }
      // Both versions are valuable; never replace the browser's existing answer.
      id = newId();
      if (!id || records.has(id)) throw new Error('无法创建导入副本，请重试。');
      summary.conflicts++;
    }
    records.set(id, { ...record, id });
    signatures.set(signature(record), id);
    restoredIds.set(record.id, id);
    summary.added++;
  }
  const activeId = current.activeId ?? (incoming.activeId ? restoredIds.get(incoming.activeId) : undefined)
    ?? restoredIds.values().next().value ?? null;
  return { history: { version: 1, activeId, records: [...records.values()].sort((a, b) => b.createdAt - a.createdAt) }, summary };
}
