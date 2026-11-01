'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { addChartRecord, addComparisonRecord, decodeHistory, emptyHistory, newRecordId, updateRecordInsight, type ChartHistory, type SavedInsight } from './chart-history';
import { mergeHistoryBackup, parseHistoryBackup, serializeHistoryBackup } from './history-backup';
import { AccountRequestError, accountRequest, useAccount } from '@/components/AccountProvider';
import { registerAccountSave } from './account-sync';
import { mergeTopicRecords } from './insight-topics';

function mergeRemote(remote: ChartHistory, local: ChartHistory, deletedIds: string[] = [], preferLocalActive = true): ChartHistory {
  const deleted = new Set(deletedIds);
  const records = new Map(remote.records.map(record => [record.id, record]));
  for (const record of local.records) if (!deleted.has(record.id)) records.set(record.id, records.has(record.id) ? mergeTopicRecords(records.get(record.id)!, record) : record);
  for (const id of deleted) records.delete(id);
  const active = preferLocalActive ? local.activeId : remote.activeId;
  return { version: 1, activeId: active && records.has(active) ? active : null, records: [...records.values()].sort((a, b) => b.createdAt - a.createdAt) };
}
export function useChartHistory() {
  const { user, refresh } = useAccount(); const userId = user?.id;
  const [history, setHistory] = useState<ChartHistory>(emptyHistory);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [syncState, setSyncState] = useState('正在读取账号记录…');
  const latest = useRef<ChartHistory>(emptyHistory()); const owner = useRef<string | undefined>(undefined);
  const dirty = useRef(false); const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const cache = useCallback((value: ChartHistory) => {
    if (!owner.current) return;
    try { localStorage.setItem(`ziwei_account_${owner.current}_history_v1`, JSON.stringify(value)); }
    catch { setStorageError('浏览器缓存不可用，正在尝试直接保存到账号。'); }
  }, []);
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inFlight.current) { await inFlight.current; if (dirty.current) await flushRef.current(); return; }
    if (!dirty.current || !userId || owner.current !== userId) return;
    const version = generation.current; const snapshot = latest.current;
    setSyncState('正在保存到账户…');
    const task = (async () => {
      const data = await accountRequest('/api/history', 'PUT', snapshot);
      if (owner.current !== userId) return;
      latest.current = mergeRemote(data.history, latest.current, data.deletedIds);
      setHistory(latest.current); cache(latest.current);
      if (generation.current === version) dirty.current = false;
      setStorageError(''); setSyncState(dirty.current ? '正在保存更新…' : '已同步到账户');
    })();
    inFlight.current = task;
    try { await task; }
    catch (error) { if (owner.current === userId) { setStorageError(error instanceof Error ? error.message : '保存失败，请重试。'); setSyncState('尚未同步'); if (error instanceof AccountRequestError && error.status === 401) void refresh(); } throw error; }
    finally { if (inFlight.current === task) inFlight.current = null; }
    if (dirty.current && owner.current === userId) timer.current = setTimeout(() => { void flushRef.current().catch(() => {}); }, 1500);
  }, [userId, cache, refresh]);
  flushRef.current = flush;

  useEffect(() => {
    owner.current = userId; latest.current = emptyHistory(); dirty.current = false; generation.current = 0;
    setHistory(emptyHistory()); setReady(false); setStorageError(''); setSyncState('正在读取账号记录…');
    if (!userId) return;
    let alive = true;
    (async () => {
      let cached = emptyHistory(); let hasCache = false;
      try { const raw = localStorage.getItem(`ziwei_account_${userId}_history_v1`); cached = decodeHistory(raw); hasCache = raw !== null; } catch {}
      try {
        const data = await accountRequest('/api/history');
        if (!alive) return;
        latest.current = mergeRemote(data.history, cached, data.deletedIds, hasCache);
        dirty.current = JSON.stringify(latest.current) !== JSON.stringify(data.history);
        setHistory(latest.current); cache(latest.current); setSyncState('已同步到账户');
      } catch (error) {
        if (!alive) return;
        latest.current = cached; setHistory(cached); setSyncState('尚未同步');
        setStorageError(error instanceof Error ? error.message : '账号历史读取失败。');
        if (error instanceof AccountRequestError && error.status === 401) void refresh();
      }
      if (alive) { setReady(true); if (dirty.current) void flushRef.current().catch(() => {}); }
    })();
    const unload = () => {
      if (!dirty.current || owner.current !== userId) return;
      cache(latest.current);
      const payload = JSON.stringify(latest.current);
      if (new Blob([payload]).size < 60000) void fetch('/api/history', { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: payload }).catch(() => {});
    };
    const visibility = () => { if (document.visibilityState === 'hidden') { cache(latest.current); void flushRef.current().catch(() => {}); } };
    window.addEventListener('pagehide', unload); document.addEventListener('visibilitychange', visibility);
    const unregister = registerAccountSave(() => flushRef.current());
    return () => {
      alive = false; unregister(); window.removeEventListener('pagehide', unload); document.removeEventListener('visibilitychange', visibility);
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (dirty.current && owner.current === userId) { cache(latest.current); void flushRef.current().catch(() => {}); }
    };
  }, [userId, cache, refresh]);

  const commit = useCallback((next: ChartHistory, immediate = false) => {
    if (!userId || owner.current !== userId || next === latest.current) return;
    latest.current = next; generation.current++; dirty.current = true;
    setHistory(next); cache(next); setSyncState('等待同步…');
    if (immediate) void flushRef.current().catch(() => {});
    else if (!timer.current) timer.current = setTimeout(() => { void flushRef.current().catch(() => {}); }, 1500);
  }, [userId, cache]);
  const create = useCallback((chart: ZiweiChart) => { const id = newRecordId(); commit(addChartRecord(latest.current, chart, id), true); return id; }, [commit]);
  const createComparison = useCallback((chart: ZiweiChart, chartB: ZiweiChart) => { const id = newRecordId(); commit(addComparisonRecord(latest.current, chart, chartB, id), true); return id; }, [commit]);
  const select = useCallback((id: string | null) => {
    if (id !== null && !latest.current.records.some(record => record.id === id)) return;
    commit({ ...latest.current, activeId: id }, true);
  }, [commit]);
  const updateInsight = useCallback((id: string, insight: SavedInsight, immediate = false) => {
    const existing = latest.current.records.find(record => record.id === id);
    commit(updateRecordInsight(latest.current, id, insight, Math.max(Date.now(), (existing?.updatedAt || 0) + 1)), immediate);
  }, [commit]);
  const exportBackup = useCallback(() => ({ json: serializeHistoryBackup(latest.current), count: latest.current.records.length }), []);
  const importBackup = useCallback(async (raw: string) => {
    await flushRef.current();
    const merged = mergeHistoryBackup(latest.current, parseHistoryBackup(raw));
    const data = await accountRequest('/api/history', 'PUT', { history: merged.history, restore: true });
    if (owner.current !== userId) throw new Error('账号已变化，请重新导入。');
    latest.current = data.history; dirty.current = false; setHistory(data.history); cache(data.history); setStorageError(''); setSyncState('已同步到账户');
    return merged.summary;
  }, [userId, cache]);
  const remove = useCallback(async (id: string) => {
    await flushRef.current();
    if (owner.current !== userId) throw new Error('账号已变化，请刷新后重试。');
    await accountRequest(`/api/history/${encodeURIComponent(id)}`, 'DELETE');
    if (owner.current !== userId) return;
    latest.current = { ...latest.current, activeId: latest.current.activeId === id ? null : latest.current.activeId, records: latest.current.records.filter(record => record.id !== id) };
    setHistory(latest.current); cache(latest.current);
  }, [cache, userId]);
  const rename = useCallback((id: string, label: string) => {
    commit({ ...latest.current, records: latest.current.records.map(record => record.id === id ? { ...record, label: label.trim().slice(0, 200), updatedAt: Math.max(Date.now(), record.updatedAt + 1) } : record) }, true);
  }, [commit]);
  return { history: owner.current === userId ? history : emptyHistory(), ready: ready && owner.current === userId, storageError, syncState, create, createComparison, select, updateInsight, exportBackup, importBackup, remove, rename, retrySync: flush };
}
