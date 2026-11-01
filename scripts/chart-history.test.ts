import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateChart } from '../lib/ziwei/algorithm';
import {
  addChartRecord, CHART_HISTORY_KEY, decodeHistory, emptyHistory, HISTORY_BACKUP_KEY, historyStorageError,
  updateRecordInsight, writeHistory, addComparisonRecord, isComparisonRecord, recordHref, type HistoryStorage, type SavedInsight,
} from '../lib/chart-history';
import { BACKUP_FORMAT, backupFilename, MAX_BACKUP_BYTES, mergeHistoryBackup, parseHistoryBackup, serializeHistoryBackup } from '../lib/history-backup';
import { comparisonProfessional, insightMessages, mergeTopicRecords, projectComparison, projectInsight, topicConversations, type TopicConversations } from '../lib/insight-topics';

const chart = generateChart({ year: 1990, month: 6, day: 15, hour: 6, gender: 'male', name: '保存测试', city: '北京' });
const completed: SavedInsight = {
  activeTopic: 'career', phase: 'complete',
  messages: [{ role: 'user', content: '解读事业', hidden: true }, { role: 'assistant', content: '命宫主星：武曲、天府。' },
    { role: 'user', content: '如何合作？' }, { role: 'assistant', content: '先明确双方职责。' }],
};
const thread = (content: string, updatedAt: number, phase: 'complete' | 'running' = 'complete') => ({ messages: [{role:'assistant' as const,content}], phase, updatedAt });

test('v4 keeps both reading styles, all topics and both parties through JSON and refresh', () => {
  let history=addComparisonRecord(addChartRecord(emptyHistory(),chart,'single',1),chart,chart,'pair',2);
  history=updateRecordInsight(history,'single',projectInsight({career:thread('专业事业',10),love:thread('专业感情',12)},'career',{readingMode:'plain',plainTopics:{career:thread('白话事业',20),love:thread('白话感情',22)}}),30);
  history=updateRecordInsight(history,'pair',projectComparison(thread('专业合盘',40),{overview:thread('白话合盘',50)},'plain'),60);
  const json=serializeHistoryBackup(history);assert.equal(JSON.parse(json).version,4);
  assert.deepEqual(parseHistoryBackup(json),JSON.parse(JSON.stringify(history)));
  const restored=decodeHistory(JSON.stringify(history));
  assert.equal(restored.records.find(r=>r.id==='pair')!.insight.messages[0].content,'专业合盘');
  assert.deepEqual(insightMessages(restored.records.find(r=>r.id==='single')!.insight).map(m=>m.content),['专业感情','专业事业','白话感情','白话事业']);
});
test('independent professional and plain device edits merge for single charts and comparisons',()=>{
  for(const comparison of[false,true]){
    const base=(comparison?addComparisonRecord(emptyHistory(),chart,chart,'a',1):addChartRecord(emptyHistory(),chart,'a',1));
    const project=(pro:ReturnType<typeof thread>,plain:ReturnType<typeof thread>,mode:'professional'|'plain')=>comparison?projectComparison(pro,{overview:plain},mode):projectInsight({overview:pro},'overview',{plainTopics:{overview:plain},readingMode:mode});
    const a=updateRecordInsight(base,'a',project(thread('专业新',100),thread('白话旧',20),'professional'),200).records[0];
    const b=updateRecordInsight(base,'a',project(thread('专业旧',10),thread('白话新',110),'plain'),190).records[0];
    const merged=mergeTopicRecords(a,b);assert.equal(merged.insight.messages[0].content,'专业新');assert.equal(merged.insight.plainTopics!.overview!.messages[0].content,'白话新');
    if(comparison)assert.equal(comparisonProfessional(merged.insight).updatedAt,100);
  }
});
test('mode and clock changes deduplicate while changing plain content preserves an import copy',()=>{
  const first=updateRecordInsight(addChartRecord(emptyHistory(),chart,'a',1),'a',projectInsight({overview:thread('专业',10)},'overview',{plainTopics:{overview:thread('白话',20)},readingMode:'plain'}),30);
  const selection=updateRecordInsight(first,'a',{...first.records[0].insight,readingMode:'professional',plainTopics:{overview:thread('白话',90)}},100);
  assert.equal(mergeHistoryBackup(first,selection).summary.skipped,1);
  const changed=updateRecordInsight(first,'a',{...first.records[0].insight,plainTopics:{overview:thread('另一白话',110)}},120);
  assert.equal(mergeHistoryBackup(first,changed).summary.conflicts,1);
});
test('restoring interrupts both styles and invalid mode metadata is rejected atomically',()=>{
  const history=updateRecordInsight(addChartRecord(emptyHistory(),chart,'a',1),'a',projectInsight({overview:thread('专业部分',10,'running')},'overview',{readingMode:'plain',plainTopics:{overview:thread('白话部分',20,'running')}}),30);
  const restored=parseHistoryBackup(serializeHistoryBackup(history));assert.equal(restored.records[0].insight.phase,'interrupted');assert.equal(restored.records[0].insight.plainTopics!.overview!.phase,'interrupted');
  for(const bad of[{readingMode:'other'},{readingMode:'plain',plainTopics:undefined},{plainTopics:{unknown:thread('错',1)}},{plainTopics:{overview:thread('错',NaN)}}]){
    const copy=structuredClone(history);Object.assign(copy.records[0].insight,bad);assert.throws(()=>decodeHistory(JSON.stringify(copy)));
  }
  const pair=updateRecordInsight(addComparisonRecord(emptyHistory(),chart,chart,'b',1),'b',projectComparison(thread('专业',1),{career:thread('错误主题',2)},'plain'),3);
  assert.throws(()=>decodeHistory(JSON.stringify(pair)));
});
function memoryStorage() {
  const data = new Map<string, string>();
  const storage: HistoryStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
  return { storage, data };
}

test('complete chart, private prompts, answers and active topic survive serialization', () => {
  const { storage } = memoryStorage();
  const history = updateRecordInsight(addChartRecord(emptyHistory(), chart, 'a', 10), 'a', completed, 20);
  writeHistory(storage, history);
  assert.deepEqual(decodeHistory(storage.getItem(CHART_HISTORY_KEY)), JSON.parse(JSON.stringify(history)));
  assert.equal(history.records[0].createdAt, 10);
  assert.equal(history.records[0].updatedAt, 20);
});

test('a refresh during generation preserves partial text and marks the turn interrupted', () => {
  const running: SavedInsight = { activeTopic: 'overview', phase: 'running', messages: [
    { role: 'user', content: '生成总览', hidden: true }, { role: 'assistant', content: '已经收到的部分解读' },
  ] };
  const saved = updateRecordInsight(addChartRecord(emptyHistory(), chart, 'a'), 'a', running);
  const restored = decodeHistory(JSON.stringify(saved));
  assert.equal(restored.records[0].insight.phase, 'interrupted');
  assert.deepEqual(restored.records[0].insight.messages, running.messages);
  assert.equal(saved.records[0].insight.phase, 'running');
});

test('an empty unfinished assistant placeholder is removed on restore', () => {
  const history = updateRecordInsight(addChartRecord(emptyHistory(), chart, 'a'), 'a', {
    ...completed, phase: 'running', messages: [{ role: 'user', content: '解读', hidden: true }, { role: 'assistant', content: '' }],
  });
  assert.deepEqual(decodeHistory(JSON.stringify(history)).records[0].insight.messages, [{ role: 'user', content: '解读', hidden: true }]);
});

test('multiple runs of the same birth chart remain separate records', () => {
  const first = updateRecordInsight(addChartRecord(emptyHistory(), chart, 'a', 10), 'a', completed);
  const next = addChartRecord(first, chart, 'b', 30);
  assert.equal(next.records.length, 2);
  assert.deepEqual(next.records[1].insight, completed);
  assert.equal(next.activeId, 'b');
  assert.match(next.records[0].label, /保存测试.*1990-06-15.*午时.*男.*北京/);
});

test('a late update from another record never switches or replaces the active record', () => {
  const history = addChartRecord(addChartRecord(emptyHistory(), chart, 'a'), chart, 'b');
  const updated = updateRecordInsight(history, 'a', completed);
  assert.equal(updated.activeId, 'b');
  assert.equal(updated.records.find(record => record.id === 'b')!.insight.messages.length, 0);
  assert.deepEqual(updated.records.find(record => record.id === 'a')!.insight, completed);
  assert.equal(updateRecordInsight(updated, 'missing', completed), updated);
});

test('unreadable storage is copied to recovery before a new record replaces it', () => {
  const { storage, data } = memoryStorage();
  data.set(CHART_HISTORY_KEY, '{damaged data');
  assert.throws(() => decodeHistory(storage.getItem(CHART_HISTORY_KEY)));
  writeHistory(storage, addChartRecord(emptyHistory(), chart, 'a'));
  assert.equal(data.get(HISTORY_BACKUP_KEY), '{damaged data');
  assert.equal(decodeHistory(data.get(CHART_HISTORY_KEY)!).records.length, 1);
});

test('quota failures retain the prior stored result and report that new content is unsaved', () => {
  const original = JSON.stringify(addChartRecord(emptyHistory(), chart, 'a'));
  const quota = new DOMException('Storage full', 'QuotaExceededError');
  const storage: HistoryStorage = { getItem: () => original, setItem: () => { throw quota; } };
  assert.throws(() => writeHistory(storage, emptyHistory()), /Storage full/);
  assert.equal(storage.getItem(CHART_HISTORY_KEY), original);
  assert.match(historyStorageError(quota), /尚未保存/);
});

test('saving from a stale tab preserves records created in another tab', () => {
  const { storage } = memoryStorage();
  writeHistory(storage, addChartRecord(emptyHistory(), chart, 'other-tab', 10));
  const saved = writeHistory(storage, addChartRecord(emptyHistory(), chart, 'this-tab', 20));
  assert.deepEqual(saved.records.map(record => record.id), ['this-tab', 'other-tab']);
  assert.equal(saved.activeId, 'this-tab');
});

test('a stale tab cannot replace a newer saved interpretation with an older snapshot', () => {
  const { storage } = memoryStorage();
  const original = addChartRecord(emptyHistory(), chart, 'a', 10);
  writeHistory(storage, updateRecordInsight(original, 'a', completed, 30));
  const saved = writeHistory(storage, original);
  assert.deepEqual(saved.records[0].insight, completed);
});

test('invalid charts and dangling active ids are rejected without trusting their shape', () => {
  const history = addChartRecord(emptyHistory(), chart, 'a');
  assert.throws(() => decodeHistory(JSON.stringify({ ...history, activeId: 'missing' })));
  assert.throws(() => decodeHistory(JSON.stringify({ ...history, records: [{ ...history.records[0], chart: { ...chart, palaces: [] } }] })));
  assert.deepEqual(decodeHistory(null), emptyHistory());
});

test('JSON backup round-trip preserves charts, Chinese conversations, hidden prompts and active selection', () => {
  const history = updateRecordInsight(addChartRecord(emptyHistory(), chart, 'a', 10), 'a', completed, 20);
  const json = serializeHistoryBackup(history, new Date('2026-10-31T16:05:06Z'));
  assert.equal(JSON.parse(json).format, BACKUP_FORMAT);
  assert.equal(JSON.parse(json).exportedAt, '2026-10-31T16:05:06.000Z');
  assert.deepEqual(parseHistoryBackup('\uFEFF' + json), JSON.parse(JSON.stringify(history)));
  assert.equal(backupFilename(new Date('2026-10-31T16:05:06Z')), 'ziwei-history-20261101-000506.json');
});

test('restoring a running backup keeps partial text and never claims the job is still running', () => {
  const history = updateRecordInsight(addChartRecord(emptyHistory(), chart, 'a'), 'a', {
    ...completed, phase: 'running', messages: [{ role: 'user', content: '解读' }, { role: 'assistant', content: '部分文字' }],
  });
  const restored = parseHistoryBackup(serializeHistoryBackup(history));
  assert.equal(restored.records[0].insight.phase, 'interrupted');
  assert.equal(restored.records[0].insight.messages.at(-1)!.content, '部分文字');
  assert.equal(history.records[0].insight.phase, 'running');
});

test('import into an empty browser restores active selection and merges into an existing browser', () => {
  const incoming = updateRecordInsight(addChartRecord(emptyHistory(), chart, 'a', 10), 'a', completed, 20);
  const first = mergeHistoryBackup(emptyHistory(), incoming);
  assert.equal(first.history.activeId, 'a');
  assert.deepEqual(first.summary, { added: 1, skipped: 0, conflicts: 0 });
  const local = addChartRecord(emptyHistory(), chart, 'local', 30);
  const merged = mergeHistoryBackup(local, incoming);
  assert.equal(merged.history.activeId, 'local');
  assert.equal(merged.history.records.length, 2);
});

test('re-importing the same backup skips identical records regardless of JSON key order', () => {
  const incoming = updateRecordInsight(addChartRecord(emptyHistory(), chart, 'a'), 'a', completed);
  const reordered = JSON.parse(JSON.stringify(incoming));
  reordered.records[0].insight = { phase: 'complete', messages: completed.messages, activeTopic: 'career' };
  const result = mergeHistoryBackup(incoming, reordered);
  assert.equal(result.history.records.length, 1);
  assert.deepEqual(result.summary, { added: 0, skipped: 1, conflicts: 0 });
});

test('conflicting interpretations are preserved as copies and repeated import does not create more copies', () => {
  const local = updateRecordInsight(addChartRecord(emptyHistory(), chart, 'a', 10), 'a', completed, 20);
  const different = updateRecordInsight(local, 'a', { ...completed, messages: [{ role: 'assistant', content: '另一个浏览器中的回答' }] }, 30);
  const merged = mergeHistoryBackup(local, different, () => 'conflict-copy');
  assert.equal(merged.history.records.length, 2);
  assert.deepEqual(merged.history.records.find(record => record.id === 'a')!.insight, completed);
  assert.equal(merged.history.records.find(record => record.id === 'conflict-copy')!.insight.messages[0].content, '另一个浏览器中的回答');
  assert.deepEqual(merged.summary, { added: 1, skipped: 0, conflicts: 1 });
  const repeated = mergeHistoryBackup(merged.history, different, () => assert.fail('Should deduplicate the existing copy'));
  assert.equal(repeated.history.records.length, 2);
  assert.equal(repeated.summary.skipped, 1);
});

test('malformed, foreign, unsupported and structurally invalid backups are rejected as a whole', () => {
  assert.throws(() => parseHistoryBackup('not json'), /有效的 JSON/);
  assert.throws(() => parseHistoryBackup(JSON.stringify({ ...emptyHistory(), format: 'other-app' })), /格式/);
  assert.throws(() => parseHistoryBackup(JSON.stringify({ ...emptyHistory(), version: 5 })), /版本/);
  const valid = addChartRecord(emptyHistory(), chart, 'a');
  const invalid = JSON.parse(JSON.stringify(valid));
  invalid.records.push({ ...invalid.records[0], id: 'invalid', chart: {} });
  assert.throws(() => parseHistoryBackup(JSON.stringify(invalid)), /命盘或对话格式/);
  assert.equal(valid.records.length, 1);
  assert.throws(() => parseHistoryBackup(' '.repeat(MAX_BACKUP_BYTES + 1)), /20 MB/);
});

test('import rejects malformed nested display fields and duplicate palace indexes', () => {
  const valid = addChartRecord(emptyHistory(), chart, 'a');
  for (const change of [
    (value: any) => { value.records[0].chart.birthInfo.name = { unsafe: 'object' }; },
    (value: any) => { value.records[0].chart.lunarInfo.fourPillars = 'not-an-array'; },
    (value: any) => { value.records[0].chart.palaces[0].branch = value.records[0].chart.palaces[1].branch; },
  ]) {
    const value = JSON.parse(JSON.stringify(valid)); change(value);
    assert.throws(() => parseHistoryBackup(JSON.stringify(value)), /命盘或对话格式/);
  }
});

const secondChart = generateChart({ year: 1992, month: 8, day: 20, hour: 3, gender: 'female', name: '乙方测试', city: '杭州' });
test('mixed JSON v2 round-trip preserves both parties, all follow-ups, citations and active comparison', () => {
  const first = addChartRecord(emptyHistory(), chart, 'single', 10);
  const mixed = updateRecordInsight(addComparisonRecord(first, chart, secondChart, 'pair', 20), 'pair', {
    ...completed, messages: [...completed.messages, { role: 'assistant', content: '双方均需沟通[资料1]。\n[资料1] [原文](/sources?ref=tianji%3A1)' }],
  }, 30);
  const json = serializeHistoryBackup(mixed); assert.equal(JSON.parse(json).version, 2);
  const restored = parseHistoryBackup(json); assert.deepEqual(restored, JSON.parse(JSON.stringify(mixed)));
  const pair = restored.records.find(record => record.id === 'pair')!; assert.ok(isComparisonRecord(pair));
  assert.equal(pair.chartB.birthInfo.name, '乙方测试'); assert.match(pair.insight.messages.at(-1)!.content, /sources\?ref=/);
  assert.equal(recordHref(pair), '/heming?record=pair'); assert.equal(recordHref(restored.records.find(r => r.id === 'single')!), '/chart?record=single');
});
test('legacy single-chart backups stay v1 and still merge without duplication', () => {
  const legacy = addChartRecord(emptyHistory(), chart, 'single', 10);
  const raw = serializeHistoryBackup(legacy); assert.equal(JSON.parse(raw).version, 1);
  const explicit = structuredClone(legacy); explicit.records[0].kind = 'single';
  assert.equal(mergeHistoryBackup(explicit, parseHistoryBackup(raw)).summary.skipped, 1);
});
test('changing only party B preserves an import conflict rather than silently deduplicating', () => {
  const original = addComparisonRecord(emptyHistory(), chart, secondChart, 'pair', 10);
  const changed = structuredClone(original); const pair = changed.records[0]; assert.ok(isComparisonRecord(pair));
  pair.chartB.birthInfo.name = '另一位乙方';
  const merged = mergeHistoryBackup(original, changed, () => 'pair-copy');
  assert.deepEqual(merged.summary, { added: 1, skipped: 0, conflicts: 1 });
  assert.equal(merged.history.records.length, 2);
  assert.equal(mergeHistoryBackup(merged.history, changed).summary.skipped, 1);
});
test('comparison restore keeps streamed partial text and marks it interrupted', () => {
  const history = updateRecordInsight(addComparisonRecord(emptyHistory(), chart, secondChart, 'pair'), 'pair', {
    activeTopic: 'overview', phase: 'running', messages: [{ role: 'user', content: '分析合盘' }, { role: 'assistant', content: '已收到的部分合盘结果' }],
  });
  const restored = parseHistoryBackup(serializeHistoryBackup(history));
  assert.equal(restored.records[0].insight.phase, 'interrupted'); assert.equal(restored.records[0].insight.messages[1].content, '已收到的部分合盘结果');
});
test('missing or invalid second charts, unknown kinds, and hidden second parties are rejected atomically', () => {
  const pair = addComparisonRecord(emptyHistory(), chart, secondChart, 'pair');
  for (const change of [
    (value: any) => { delete value.records[0].chartB; },
    (value: any) => { value.records[0].chartB.palaces = []; },
    (value: any) => { value.records[0].kind = 'other'; },
    (value: any) => { delete value.records[0].kind; },
    (value: any) => { value.records[0].kind = 'single'; },
  ]) {
    const broken = JSON.parse(serializeHistoryBackup(pair)); change(broken);
    assert.throws(() => parseHistoryBackup(JSON.stringify(broken)), /命盘或对话格式/);
  }
});

test('legacy mixed topics split only on explicit hidden prompts and retain all responses and follow-ups', () => {
  const messages: SavedInsight['messages'] = [
    { role: 'user', content: '请生成命格总览，按以下结构输出：', hidden: true }, { role: 'assistant', content: '命格旧答案[资料1]' },
    { role: 'user', content: '命格的追问' }, { role: 'assistant', content: '命格追问答案' },
    { role: 'user', content: '请深度分析事业运，按以下结构输出：', hidden: true }, { role: 'assistant', content: '事业旧答案' },
    { role: 'user', content: '请深度分析感情婚姻运，按以下结构输出：', hidden: true }, { role: 'assistant', content: '感情旧答案' },
  ];
  const topics = topicConversations({ messages, activeTopic: 'love', phase: 'complete' }, 100);
  assert.equal(topics.overview!.messages.length, 4); assert.equal(topics.career!.messages.at(-1)!.content, '事业旧答案');
  assert.equal(topics.love!.messages.at(-1)!.content, '感情旧答案'); assert.equal(topics.love!.updatedAt, 100);
  assert.equal(Object.values(topics).reduce((n, topic) => n + topic!.messages.length, 0), messages.length);
  const fallback = topicConversations({ messages: [{ role: 'user', content: '没有明确主题标记的旧问题' }], activeTopic: 'career', phase: 'stopped' });
  assert.equal(fallback.career!.messages[0].content, '没有明确主题标记的旧问题'); assert.equal(fallback.overview, undefined);
});
test('topic v3 backups retain every tab while exposing only the active tab at the root', () => {
  const topics: TopicConversations = {
    overview: { messages: [{ role: 'assistant', content: '独立命格' }], phase: 'complete', updatedAt: 10 },
    career: { messages: [{ role: 'user', content: '只属于事业的追问' }, { role: 'assistant', content: '独立事业[资料1]' }], phase: 'complete', updatedAt: 20 },
  };
  const history = updateRecordInsight(addChartRecord(emptyHistory(), chart, 'tabs', 1), 'tabs', projectInsight(topics, 'career'), 30);
  const json = serializeHistoryBackup(history); assert.equal(JSON.parse(json).version, 3);
  const restored = parseHistoryBackup(json); assert.equal(restored.records[0].insight.topics!.overview!.messages[0].content, '独立命格');
  assert.equal(restored.records[0].insight.messages.length, 2); assert.equal(insightMessages(restored.records[0].insight).filter(m => m.role === 'assistant').length, 2);
});
test('switching only the active tab or changing topic clocks does not create duplicate imports', () => {
  const topics: TopicConversations = {
    overview: { messages: [{ role: 'assistant', content: '命格' }], phase: 'complete', updatedAt: 10 },
    career: { messages: [{ role: 'assistant', content: '事业' }], phase: 'complete', updatedAt: 20 },
  };
  const first = updateRecordInsight(addChartRecord(emptyHistory(), chart, 'tabs', 1), 'tabs', projectInsight(topics, 'overview'), 30);
  const second = updateRecordInsight(first, 'tabs', projectInsight({ ...topics, career: { ...topics.career!, updatedAt: 50 } }, 'career'), 60);
  assert.deepEqual(mergeHistoryBackup(first, second).summary, { added: 0, skipped: 1, conflicts: 0 });
});
test('legacy and migrated backups deduplicate, but changes to an inactive topic preserve a conflict copy', () => {
  const legacy = updateRecordInsight(addChartRecord(emptyHistory(), chart, 'tabs', 1), 'tabs', {
    activeTopic: 'career', phase: 'complete', messages: [
      { role: 'user', hidden: true, content: '请生成命格总览' }, { role: 'assistant', content: '原命格' },
      { role: 'user', hidden: true, content: '请深度分析事业运' }, { role: 'assistant', content: '原事业' },
    ],
  }, 20);
  const topics = topicConversations(legacy.records[0].insight);
  const migrated = updateRecordInsight(legacy, 'tabs', projectInsight(topics, 'overview'), 30);
  assert.equal(mergeHistoryBackup(migrated, legacy).summary.skipped, 1);
  const changed = updateRecordInsight(migrated, 'tabs', projectInsight({ ...topics, career: { ...topics.career!, messages: [{ role: 'assistant', content: '新的事业答案' }], updatedAt: 40 } }, 'overview'), 40);
  const merged = mergeHistoryBackup(migrated, changed, () => 'inactive-topic-copy');
  assert.equal(merged.summary.conflicts, 1); assert.equal(mergeHistoryBackup(merged.history, changed).summary.skipped, 1);
});
test('restoring interrupts every running tab without altering completed topics', () => {
  const insight = projectInsight({
    overview: { messages: [{ role: 'assistant', content: '已完成命格' }], phase: 'complete', updatedAt: 10 },
    career: { messages: [{ role: 'assistant', content: '事业部分文字' }, { role: 'assistant', content: '' }], phase: 'running', updatedAt: 20 },
  }, 'overview');
  const restored = parseHistoryBackup(serializeHistoryBackup(updateRecordInsight(addChartRecord(emptyHistory(), chart, 'tabs'), 'tabs', insight)));
  assert.equal(restored.records[0].insight.phase, 'complete'); assert.equal(restored.records[0].insight.topics!.career!.phase, 'interrupted');
  assert.equal(restored.records[0].insight.topics!.career!.messages.length, 1);
});
test('topic merge retains independent device updates and prefers each topic clock over the record clock', () => {
  const base = addChartRecord(emptyHistory(), chart, 'tabs', 1);
  const a = updateRecordInsight(base, 'tabs', projectInsight({ career: { messages: [{ role: 'assistant', content: '设备A事业' }], phase: 'complete', updatedAt: 20 } }, 'career'), 100).records[0];
  const b = updateRecordInsight(base, 'tabs', projectInsight({ wealth: { messages: [{ role: 'assistant', content: '设备B财运' }], phase: 'complete', updatedAt: 30 } }, 'wealth'), 90).records[0];
  const merged = mergeTopicRecords(a, b);
  assert.equal(merged.insight.topics!.career!.messages[0].content, '设备A事业'); assert.equal(merged.insight.topics!.wealth!.messages[0].content, '设备B财运');
  const stale = { ...a, updatedAt: 200, insight: projectInsight({ career: { messages: [{ role: 'assistant', content: '过时事业' }], phase: 'complete', updatedAt: 15 } }, 'career') };
  assert.equal(mergeTopicRecords(merged, stale).insight.topics!.career!.messages[0].content, '设备A事业');
});
test('malformed topic metadata, mismatched projections and comparison topics are rejected', () => {
  const good = updateRecordInsight(addChartRecord(emptyHistory(), chart, 'tabs'), 'tabs', projectInsight({ career: { messages: [{ role: 'assistant', content: '事业' }], phase: 'complete', updatedAt: 10 } }, 'career'));
  for (const mutate of [
    (record: any) => { record.insight.topics.other = record.insight.topics.career; },
    (record: any) => { record.insight.topics.career.updatedAt = 'ten'; },
    (record: any) => { record.insight.topics.career.updatedAt = -1; },
    (record: any) => { record.insight.topics.career.messages[0].role = 'system'; },
    (record: any) => { record.insight.messages = []; },
    (record: any) => { record.insight.phase = 'error'; },
    (record: any) => { record.kind = 'comparison'; record.chartB = secondChart; },
  ]) {
    const broken = JSON.parse(serializeHistoryBackup(good)); mutate(broken.records[0]);
    assert.throws(() => parseHistoryBackup(JSON.stringify(broken)), /命盘或对话格式/);
  }
});
