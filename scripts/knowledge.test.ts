import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { buildKnowledge, TOPICS } from './build-knowledge.mjs';
import { retrieveKnowledge, getKnowledgeSource, knowledgeFooter, knowledgeStatus, selectKnowledgeTopics } from '../lib/server/knowledge';
import { generateChart } from '../lib/ziwei/algorithm';
import { handleInterpretation } from '../lib/server/interpretation';
import { readAIStream } from '../lib/ai-stream';
import { GET as knowledgeGET } from '../app/api/knowledge/route';
import { codexResponse } from '../lib/server/codex-cli';

mkdirSync(path.resolve('.codex-local'), { recursive: true });
const root = mkdtempSync(path.resolve('.codex-local/knowledge-test-'));
const output = path.join(root, 'index/knowledge.sqlite');
const original = { ...process.env };
const birth = { year: 1962, month: 4, day: 15, hour: 6, gender: 'male' as const };
const current = generateChart(birth);
const subjects = [{ chart: current, label: '本命盘' }];
const body = (h: number, g: string) => Object.fromEntries(TOPICS.map((topic: string) => [topic, `${topic} 精确时辰${h} 性别${g} 的原始参考段落。` + '对照当前命盘，不覆盖亮度。'.repeat(90)]));
before(async () => {
  for (const folder of ['original/v3.0-samples/expanded/ziwei-samples-toolkit/samples-out/year-1962', 'original/v4.0-13d/years', 'resources/tianji']) mkdirSync(path.join(root, folder), { recursive: true });
  const v4 = [6, 7].flatMap(h => ['male', 'female'].map(g => ({ y: 1962, m: 4, d: 15, h, g, ms: '武曲', c: body(h, g) })));
  writeFileSync(path.join(root, 'original/v4.0-13d/years/year-1962.jsonl.zst'), zstdCompressSync(Buffer.from(v4.map(r => JSON.stringify(r)).join('\n') + '\n')));
  const v3 = [{ birthInfo: birth, topics: body(6, 'male') }, { birthInfo: { ...birth, month: 2, day: 30 }, topics: body(6, 'male') }];
  writeFileSync(path.join(root, 'original/v3.0-samples/expanded/ziwei-samples-toolkit/samples-out/year-1962/1962-04.jsonl.gz'), gzipSync(v3.map(r => JSON.stringify(r)).join('\n')));
  writeFileSync(path.join(root, 'resources/classics.json'), JSON.stringify([{ slug: 'test', title: '古籍整理', chapters: [{ title: '事业', paragraphs: [{ id: 'test-1', text: '官禄宫看事业，命宫星曜结合迁移宫与财帛宫一同观察。' }] }] }]));
  writeFileSync(path.join(root, 'resources/tianji/entries.jsonl'), JSON.stringify({ book: '03', h2: '事业', h3: '官禄宫', quote: '官禄宫的事业取象要和命宫一同观察，不宜只论一星。', t_hms: '00:01:07', bvid: 'BV123abc', part: 2 }));
  await buildKnowledge(root, output, { fixture: true });
  process.env.KNOWLEDGE_DB_PATH = output; process.env.KNOWLEDGE_REQUIRED = 'true'; process.env.KNOWLEDGE_USE_MODE = 'personal';
});
after(() => {
  for (const key of ['KNOWLEDGE_DB_PATH', 'KNOWLEDGE_REQUIRED', 'KNOWLEDGE_USE_MODE', 'CODEX_CLI_PATH', 'AUTH_REQUIRED']) {
    if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }
  assert.ok(root.startsWith(path.resolve('.codex-local') + path.sep)); rmSync(root, { recursive: true, force: true });
});
test('streaming index retains valid samples, filters impossible dates and publishes only when ready', () => {
  const status = knowledgeStatus();
  assert.equal(status.status, 'ready'); assert.equal((status as { rows: number }).rows, 5);
  assert.equal((status as { invalid: number }).invalid, 1); assert.equal(existsSync(output + '.building'), false);
});
test('retrieval matches exact date, branch-hour, gender and requested topic across versions', () => {
  const context = retrieveKnowledge(subjects, '事业和工作方向');
  const samples = context.sources.filter(s => s.kind.startsWith('v'));
  assert.deepEqual(samples.map(s => s.id), ['v4:1962-04-15:6:male:career', 'v3:1962-04-15:6:male:career']);
  assert.ok(samples.every(s => s.text.includes('精确时辰6 性别male')));
  assert.ok(context.sources.some(s => s.kind === 'classic')); assert.ok(context.sources.some(s => s.kind === 'tianji'));
});
test('full source lookup returns the correct other hour and gender, not a cached first entry', () => {
  assert.match(getKnowledgeSource('v4:1962-04-15:7:female:career')!.text, /精确时辰7 性别female/);
  assert.equal(getKnowledgeSource('v4:1962-04-15:8:female:career'), null);
});
test('uncovered birth dates never substitute a different birthday', () => {
  const context = retrieveKnowledge([{ chart: generateChart({ ...birth, year: 2030 }), label: '本命盘' }], '事业');
  assert.equal(context.sources.filter(s => s.kind.startsWith('v')).length, 0);
  assert.ok(context.notes.some(note => note.includes('未找到同排盘日')));
  assert.ok(context.sources.some(s => s.kind === 'classic'));
});
test('query intent supports short follow-ups and all thirteen dimensions', () => {
  assert.deepEqual(selectKnowledgeTopics('能具体说说吗？', '请分析工作与职业'), ['career']);
  assert.equal(selectKnowledgeTopics('父母与长辈')[0], 'parents');
  assert.equal(selectKnowledgeTopics('夫妻宫')[0], 'love');
});
test('commercial mode excludes all mixed-license samples and Tianji, including direct lookup', () => {
  process.env.KNOWLEDGE_USE_MODE = 'commercial';
  try {
    const context = retrieveKnowledge(subjects, '事业');
    assert.ok(context.sources.length); assert.ok(context.sources.every(s => s.kind === 'classic'));
    assert.equal(getKnowledgeSource('v4:1962-04-15:6:male:career'), null);
    assert.equal(getKnowledgeSource('tianji:1'), null);
  } finally { process.env.KNOWLEDGE_USE_MODE = 'personal'; }
});
test('dual charts keep party ownership and globally unique citation numbers', () => {
  const context = retrieveKnowledge([{ chart: current, label: '甲方' }, { chart: generateChart({ ...birth, gender: 'female' }), label: '乙方' }], '事业');
  assert.ok(context.sources.some(s => s.chart === '甲方' && s.id.includes(':male:')));
  assert.ok(context.sources.some(s => s.chart === '乙方' && s.id.includes(':female:')));
  assert.equal(new Set(context.sources.map(s => s.citation)).size, context.sources.length);
});
test('source references preserve locator, license, links and complete original text', () => {
  const context = retrieveKnowledge(subjects, '事业');
  const footer = knowledgeFooter(context);
  assert.match(footer, /CC BY-NC-SA 4\.0/); assert.match(footer, /sources\?ref=/);
  assert.match(footer, /王多鱼AI/); assert.match(footer, /并非每条都被采用/);
  assert.ok(getKnowledgeSource(context.sources[0].id)!.text.length >= context.sources[0].text.length);
});
test('direct lookup rejects arbitrary paths and SQL payloads', () => {
  for (const ref of ['../../codex/auth.json', "classic:' OR 1=1 --", 'v4:1962-04-15:6:male:__proto__']) assert.equal(getKnowledgeSource(ref), null);
});
test('source API requires an application login even though the corpus itself is public', () => {
  const response = knowledgeGET(new Request('http://127.0.0.1:3100/api/knowledge?ref=tianji:1'));
  assert.equal(response.status, 401);
});
test('missing or unpublished required index fails explicitly, never claiming retrieval', () => {
  process.env.KNOWLEDGE_DB_PATH = output + '.missing'; assert.throws(() => retrieveKnowledge(subjects, '事业'), /检索库暂不可用/);
  process.env.KNOWLEDGE_DB_PATH = output;
  const db = new DatabaseSync(output); db.prepare("UPDATE meta SET value='false' WHERE key='ready'").run(); db.close();
  try { assert.throws(() => retrieveKnowledge(subjects, '事业'), /尚未就绪/); }
  finally { const db = new DatabaseSync(output); db.prepare("UPDATE meta SET value='true' WHERE key='ready'").run(); db.close(); }
});
test('API injects retrieved text into the CLI prompt and appends persistent references before DONE', async () => {
  process.env.AUTH_REQUIRED = 'false'; process.env.CODEX_CLI_PATH = path.resolve('scripts/fixtures/codex-fake.mjs');
  const request = new Request('http://127.0.0.1:3100/api/interpret', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3100' },
    body: JSON.stringify({ chart: { birthInfo: birth, fakeSource: '伪造资料' }, messages: [{ role: 'user', content: '事业 __CONTEXT__' }] }) });
  const response = await handleInterpretation(request); assert.equal(response.status, 200);
  let answer = ''; let status = ''; await readAIStream(response, value => { answer = value; }, value => { status = value; });
  const task = JSON.parse(answer.split('\n\n**【本次检索资料】**')[0]);
  assert.equal(task.knowledge.status, 'ready'); assert.ok(task.knowledge.sources.some((s: { text: string }) => s.text.includes('精确时辰6')));
  assert.equal(JSON.stringify(task).includes('伪造资料'), false);
  assert.match(answer, /\*\*【本次检索资料】\*\*/); assert.match(answer, /v4:1962-04-15:6:male:career/);
});
test('a failed CLI turn never appends a successful reference footer', async () => {
  process.env.CODEX_CLI_PATH = path.resolve('scripts/fixtures/codex-fake.mjs');
  const response = codexResponse('__AUTH_ERROR__', new AbortController().signal, { footer: 'SUCCESS_REFERENCE_SHOULD_NOT_APPEAR' });
  const wire = await response.text(); assert.match(wire, /登录已失效/); assert.equal(wire.includes('SUCCESS_REFERENCE_SHOULD_NOT_APPEAR'), false);
});
