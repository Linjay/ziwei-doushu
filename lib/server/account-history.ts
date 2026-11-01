import 'server-only';
import { decodeHistory, type ChartHistory, type ChartRecord } from '../chart-history';
import { mergeTopicRecords } from '../insight-topics';
import { database, transaction } from './database';
import { HttpError } from './http';

export function readAccountHistory(userId: string): ChartHistory {
  const db = database();
  const records = db.prepare('SELECT payload FROM chart_records WHERE user_id=? ORDER BY updated_at DESC').all(userId).map(row => JSON.parse(String(row.payload)));
  const active = db.prepare('SELECT active_record FROM users WHERE id=?').get(userId)?.active_record;
  return decodeHistory(JSON.stringify({ version: 1, activeId: records.some(record => record.id === active) ? active : null, records }));
}
/** Resolve the home action without transferring complete charts or AI conversations. */
export function recentAccountChart(userId: string): string | null {
  const row = database().prepare(`SELECT record_id FROM chart_records
    WHERE user_id=? AND coalesce(json_extract(payload,'$.kind'),'single')='single'
    ORDER BY CASE WHEN record_id=(SELECT active_record FROM users WHERE id=?) THEN 0 ELSE 1 END,
      updated_at DESC,record_id ASC LIMIT 1`).get(userId,userId);
  return row ? String(row.record_id) : null;
}
export function deletedRecordIds(userId: string) {
  return database().prepare('SELECT record_id FROM history_tombstones WHERE user_id=?').all(userId).map(row => String(row.record_id));
}
export function saveAccountHistory(userId: string, value: unknown, restoreDeleted = false) {
  let incoming: ChartHistory;
  try { incoming = decodeHistory(JSON.stringify(value)); }
  catch { throw new HttpError('命盘或解读记录格式不正确。'); }
  if (incoming.records.length > 1000) throw new HttpError('单个账号最多保存 1000 条单盘与合盘记录，请先导出备份并整理。');
  for (const record of incoming.records) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(record.id) || record.label.length > 500) throw new HttpError('命盘标识或名称格式不正确。');
  }
  const db = database();
  transaction(() => {
    const tombstone = db.prepare('SELECT 1 FROM history_tombstones WHERE user_id=? AND record_id=?');
    const restore = db.prepare('DELETE FROM history_tombstones WHERE user_id=? AND record_id=?');
    const existing = db.prepare('SELECT payload FROM chart_records WHERE user_id=? AND record_id=?');
    const upsert = db.prepare(`INSERT INTO chart_records(user_id,record_id,payload,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(user_id,record_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at
      WHERE excluded.updated_at > chart_records.updated_at`);
    for (let record of incoming.records) {
      const previous = existing.get(userId, record.id);
      if (previous && (JSON.parse(String(previous.payload)).kind || 'single') !== (record.kind || 'single')) {
        throw new HttpError('记录类型不能更改，请将单盘或合盘另存为新记录。');
      }
      if (previous) {
        const saved = JSON.parse(String(previous.payload)) as ChartRecord;
        if (saved.insight.topics !== undefined && record.insight.topics === undefined && record.updatedAt > saved.updatedAt) {
          throw new HttpError('此记录已按主题保存，请刷新页面后继续，避免旧页面覆盖其他主题。');
        }
        if (saved.insight.plainTopics !== undefined && record.insight.plainTopics === undefined && record.updatedAt > saved.updatedAt) {
          throw new HttpError('此记录已保存专业与通俗解读，请刷新页面后继续，避免旧页面覆盖解读。');
        }
        const merged = mergeTopicRecords(saved, record);
        if (JSON.stringify(merged) !== JSON.stringify(saved) && (saved.insight.topics !== undefined || record.insight.topics !== undefined || saved.insight.plainTopics !== undefined || record.insight.plainTopics !== undefined)) {
          record = { ...merged, updatedAt: Math.max(saved.updatedAt + 1, record.updatedAt) };
        }
      }
      if (restoreDeleted) restore.run(userId, record.id);
      if (!tombstone.get(userId, record.id)) upsert.run(userId, record.id, JSON.stringify(record), record.updatedAt);
    }
    if (Number(db.prepare('SELECT count(*) AS total FROM chart_records WHERE user_id=?').get(userId)?.total) > 1000) throw new HttpError('命盘数量超过账号上限，请先导出备份并整理记录。');
    db.prepare('UPDATE users SET active_record=? WHERE id=?').run(incoming.activeId, userId);
  });
  return readAccountHistory(userId);
}
export function deleteAccountRecord(userId: string, recordId: string) {
  const db = database();
  transaction(() => {
    const result = db.prepare('DELETE FROM chart_records WHERE user_id=? AND record_id=?').run(userId, recordId);
    if (!result.changes) throw new HttpError('未找到这份命盘。', 404);
    db.prepare('INSERT OR IGNORE INTO history_tombstones(user_id,record_id) VALUES(?,?)').run(userId, recordId);
    db.prepare('UPDATE users SET active_record=NULL WHERE id=? AND active_record=?').run(userId, recordId);
  });
}
