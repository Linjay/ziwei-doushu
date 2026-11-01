import type { BirthInfo, ZiweiChart } from '@/lib/ziwei/types';
import { validateBirthProvenance } from './birth-input';
import { mergeTopicRecords, projectInsight, restoreInsight, type TopicConversations } from './insight-topics';
import { isReadingMode, type ReadingMode } from './reading-modes';

export const CHART_HISTORY_KEY = 'ziwei_chart_records_v1';
export const HISTORY_BACKUP_KEY = 'ziwei_chart_records_v1_recovery';

export interface InsightMessage {
  role: 'user' | 'assistant';
  content: string;
  hidden?: boolean;
}

export type InsightPhase = 'idle' | 'running' | 'complete' | 'stopped' | 'error' | 'interrupted';
export interface SavedInsight {
  messages: InsightMessage[];
  activeTopic: string;
  phase: InsightPhase;
  topics?: TopicConversations;
  readingMode?: ReadingMode;
  plainTopics?: TopicConversations;
  /** Comparisons keep their professional thread at the root, with its own merge clock. */
  professionalUpdatedAt?: number;
}
interface RecordBase {
  id: string;
  label: string;
  chart: ZiweiChart;
  insight: SavedInsight;
  createdAt: number;
  updatedAt: number;
}
export interface SingleChartRecord extends RecordBase { kind?: 'single'; chartB?: never }
export interface ComparisonRecord extends RecordBase { kind: 'comparison'; chartB: ZiweiChart }
export type ChartRecord = SingleChartRecord | ComparisonRecord;
export function isComparisonRecord(record: ChartRecord): record is ComparisonRecord { return record.kind === 'comparison'; }
export function recordHref(record: ChartRecord) { return `${isComparisonRecord(record) ? '/heming' : '/chart'}?record=${encodeURIComponent(record.id)}`; }
export interface ChartHistory {
  version: 1;
  activeId: string | null;
  records: ChartRecord[];
}
export type HistoryStorage = Pick<Storage, 'getItem' | 'setItem'>;
const topics = ['overview', 'love', 'career', 'wealth', 'health', 'personality'];
const phases: InsightPhase[] = ['idle', 'running', 'complete', 'stopped', 'error', 'interrupted'];
const branches = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optionalString = (value: unknown) => value === undefined || typeof value === 'string';
const integerIn = (value: unknown, min: number, max: number) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

export const emptyHistory = (): ChartHistory => ({ version: 1, activeId: null, records: [] });
export const emptyInsight = (): SavedInsight => ({ messages: [], activeTopic: 'overview', phase: 'idle' });
export function newRecordId() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
}

function validChart(value: unknown): value is ZiweiChart {
  if (!object(value) || !object(value.birthInfo) || !object(value.lunarInfo)) return false;
  const birth = value.birthInfo;
  if (![birth.year, birth.month, birth.day, birth.hour].every(Number.isInteger)
    || birth.hour < 0 || birth.hour > 11 || !['male', 'female'].includes(birth.gender)) return false;
  if (!['name', 'city', 'province'].every(key => optionalString(birth[key]))
    || (birth.longitude !== undefined && (!number(birth.longitude) || Math.abs(birth.longitude) > 180))) return false;
  const date = new Date(Date.UTC(birth.year, birth.month - 1, birth.day));
  if (date.getUTCFullYear() !== birth.year || date.getUTCMonth() !== birth.month - 1 || date.getUTCDate() !== birth.day) return false;
  try { validateBirthProvenance(birth as BirthInfo); } catch { return false; }
  if (!['mingGongBranch', 'shenGongBranch', 'wuxingJu', 'ziweiPos', 'currentAge', 'currentDaXianIndex'].every(key => number(value[key]))
    || typeof value.wuxingJuName !== 'string') return false;
  if (!['lunarYear', 'lunarMonth', 'lunarDay', 'yearStem', 'yearBranch'].every(key => number(value.lunarInfo[key]))) return false;
  if (!['fourPillars', 'fourPillarsLunar'].every(key => value.lunarInfo[key] === undefined
    || (Array.isArray(value.lunarInfo[key]) && value.lunarInfo[key].length === 4 && value.lunarInfo[key].every((part: unknown) => typeof part === 'string')))) return false;
  if (!['mingZhu', 'shenZhu', 'yinYangGender'].every(key => optionalString(value[key]))) return false;
  if (!Array.isArray(value.palaces) || value.palaces.length !== 12 || !value.palaces.every((palace: unknown) =>
    object(palace) && typeof palace.name === 'string' && integerIn(palace.branch, 0, 11) && integerIn(palace.stem, 0, 9)
    && optionalString(palace.borrowedFromName)
    && (palace.borrowedStars === undefined || (Array.isArray(palace.borrowedStars) && palace.borrowedStars.every((star: unknown) => typeof star === 'string')))
    && (palace.daXianAge === undefined || (Array.isArray(palace.daXianAge) && palace.daXianAge.length === 2 && palace.daXianAge.every(number)))
    && Array.isArray(palace.stars) && palace.stars.every((star: unknown) => object(star) && typeof star.name === 'string'
      && ['major', 'minor', 'lucky', 'sha'].includes(star.type) && optionalString(star.brightnessRaw)
      && (star.siHua === undefined || ['', '禄', '权', '科', '忌'].includes(star.siHua))
      && (star.brightness === undefined || ['bright', 'normal', 'dim'].includes(star.brightness))))) return false;
  if (new Set(value.palaces.map((palace: { branch: number }) => palace.branch)).size !== 12) return false;
  return Array.isArray(value.daXians) && value.daXians.every((entry: unknown) => object(entry)
    && number(entry.startAge) && number(entry.endAge) && number(entry.palaceBranch) && typeof entry.palaceName === 'string'
    && optionalString(entry.stemName)
    && (entry.siHua === undefined || (object(entry.siHua) && ['stemName', 'lu', 'quan', 'ke', 'ji'].every(key => typeof entry.siHua[key] === 'string'))));
}

function validRecord(value: unknown): value is ChartRecord {
  return object(value) && typeof value.id === 'string' && !!value.id && typeof value.label === 'string'
    && number(value.createdAt) && number(value.updatedAt) && validChart(value.chart)
    && (value.kind === 'comparison' ? validChart(value.chartB) : (value.kind === undefined || value.kind === 'single') && value.chartB === undefined)
    && object(value.insight) && topics.includes(value.insight.activeTopic) && phases.includes(value.insight.phase)
    && validMessages(value.insight.messages)
    && validTopicConversations(value.insight, value.kind === 'comparison');
}

function validMessages(value: unknown): value is InsightMessage[] {
  return Array.isArray(value) && value.every(message => object(message) && ['user', 'assistant'].includes(message.role)
    && typeof message.content === 'string' && (message.hidden === undefined || typeof message.hidden === 'boolean'));
}
function validTopicConversations(insight: Record<string, any>, comparison: boolean): boolean {
  if (insight.readingMode !== undefined && !isReadingMode(insight.readingMode)) return false;
  if (insight.professionalUpdatedAt !== undefined && (!number(insight.professionalUpdatedAt) || insight.professionalUpdatedAt < 0)) return false;
  if (insight.readingMode === 'plain' && insight.plainTopics === undefined) return false;
  if (insight.plainTopics !== undefined) {
    if (!object(insight.plainTopics) || Object.entries(insight.plainTopics).some(([key,value]) => !topics.includes(key)
      || (comparison && key !== 'overview') || !object(value) || !phases.includes(value.phase)
      || !number(value.updatedAt) || value.updatedAt < 0 || !validMessages(value.messages))) return false;
  }
  if (insight.topics === undefined) return true;
  if (comparison || !object(insight.topics) || Object.keys(insight.topics).some(key => !topics.includes(key))) return false;
  for (const conversation of Object.values(insight.topics)) {
    if (!object(conversation) || !phases.includes(conversation.phase) || !number(conversation.updatedAt) || conversation.updatedAt < 0 || !validMessages(conversation.messages)) return false;
  }
  const projected = projectInsight(insight.topics, insight.activeTopic);
  return projected.phase === insight.phase && JSON.stringify(projected.messages) === JSON.stringify(insight.messages);
}

export function decodeHistory(raw: string | null): ChartHistory {
  if (raw === null) return emptyHistory();
  const value: unknown = JSON.parse(raw);
  if (!object(value) || value.version !== 1 || !Array.isArray(value.records) || !value.records.every(validRecord)
    || !(value.activeId === null || typeof value.activeId === 'string')) throw new Error('本地历史记录格式不正确');
  const ids = new Set(value.records.map((record: ChartRecord) => record.id));
  if (ids.size !== value.records.length || (value.activeId !== null && !ids.has(value.activeId))) throw new Error('本地历史记录索引不正确');
  return {
    version: 1, activeId: value.activeId,
    records: value.records.map((record: ChartRecord) => ({ ...record, insight: restoreInsight(record.insight) })),
  };
}

export function writeHistory(storage: HistoryStorage, history: ChartHistory) {
  const previous = storage.getItem(CHART_HISTORY_KEY);
  let next = history;
  if (previous !== null) {
    let stored: ChartHistory | undefined;
    try { stored = decodeHistory(previous); }
    catch {
      // Preserve unreadable data before a user action replaces the active store.
      storage.setItem(HISTORY_BACKUP_KEY, previous);
    }
    if (stored) {
      // Preserve records saved in another tab since this page was opened.
      const records = new Map(stored.records.map(record => [record.id, record]));
      for (const record of history.records) {
        records.set(record.id, records.has(record.id) ? mergeTopicRecords(records.get(record.id)!, record) : record);
      }
      next = { ...history, records: [...records.values()].sort((a, b) => b.createdAt - a.createdAt) };
    }
  }
  storage.setItem(CHART_HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function addChartRecord(history: ChartHistory, chart: ZiweiChart, id: string, now = Date.now()): ChartHistory {
  const birth = chart.birthInfo;
  const label = [birth.name, `${birth.year}-${String(birth.month).padStart(2, '0')}-${String(birth.day).padStart(2, '0')}`,
    `${branches[birth.hour]}时`, birth.gender === 'male' ? '男' : '女', birth.city || birth.province].filter(Boolean).join(' · ');
  return { ...history, activeId: id, records: [{ id, label, chart, insight: emptyInsight(), createdAt: now, updatedAt: now }, ...history.records] };
}

export function addComparisonRecord(history: ChartHistory, chart: ZiweiChart, chartB: ZiweiChart, id: string, now = Date.now()): ChartHistory {
  const party = (value: ZiweiChart, fallback: string) => value.birthInfo.name || `${fallback} ${value.birthInfo.year}-${value.birthInfo.month}-${value.birthInfo.day}`;
  const record: ComparisonRecord = { id, kind: 'comparison', label: `${party(chart, '甲方')} × ${party(chartB, '乙方')}`, chart, chartB,
    insight: emptyInsight(), createdAt: now, updatedAt: now };
  return { ...history, activeId: id, records: [record, ...history.records] };
}

export function updateRecordInsight(history: ChartHistory, id: string, insight: SavedInsight, now = Date.now()): ChartHistory {
  if (!history.records.some(record => record.id === id)) return history;
  return { ...history, records: history.records.map(record => record.id === id ? { ...record, insight, updatedAt: now } : record) };
}

export function historyStorageError(error: unknown): string {
  return error instanceof Error && /quota/i.test(error.name)
    ? '本地存储空间不足，最新内容尚未保存。当前页面仍可继续查看。'
    : '本地记录读写失败，请检查浏览器是否允许本地存储。当前页面仍可继续使用。';
}
