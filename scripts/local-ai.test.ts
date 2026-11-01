import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import path from 'node:path';
import { codexResponse, LocalAIError } from '../lib/server/codex-cli';
import { handleInterpretation } from '../lib/server/interpretation';
import { readAIStream } from '../lib/ai-stream';
import { CodexProtocol } from '../lib/server/codex-protocol';
import { formToBirthInfo } from '../lib/birth-input';

const originalPath = process.env.CODEX_CLI_PATH;
const originalTimeout = process.env.CODEX_TIMEOUT_MS;
const originalAuthRequired = process.env.AUTH_REQUIRED;
process.env.AUTH_REQUIRED = 'false';
process.env.CODEX_CLI_PATH = path.resolve('scripts/fixtures/codex-fake.mjs');
process.env.CODEX_TIMEOUT_MS = '10000';
after(() => {
  if (originalAuthRequired === undefined) delete process.env.AUTH_REQUIRED;
  else process.env.AUTH_REQUIRED = originalAuthRequired;
  if (originalPath === undefined) delete process.env.CODEX_CLI_PATH;
  else process.env.CODEX_CLI_PATH = originalPath;
  if (originalTimeout === undefined) delete process.env.CODEX_TIMEOUT_MS;
  else process.env.CODEX_TIMEOUT_MS = originalTimeout;
});

const chart = { birthInfo: { year: 1990, month: 6, day: 15, hour: 6, gender: 'male' } };
function request(body: unknown, origin = 'http://127.0.0.1:3100') {
  return new Request('http://127.0.0.1:3100/api/interpret', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  });
}
async function reply(response: Response) {
  let text = '';
  await readAIStream(response, value => { text = value; });
  return text;
}

test('CLI stdout fragments become a complete Chinese answer; prompt stays on stdin', async () => {
  const text = await reply(codexResponse('只解读文字 $(no-command) `no-command`', new AbortController().signal));
  assert.equal(text, '命宫主星：武曲、天府。');
});

test('CLI authentication failures reach the client as readable errors', async () => {
  await assert.rejects(reply(codexResponse('__AUTH_ERROR__', new AbortController().signal)), /codex login/);
});

test('text is delivered before completion and completed snapshots never duplicate it', async () => {
  const response = codexResponse('__SLOW_STREAM__', new AbortController().signal);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let received = '';
  while (!received.includes('"delta"')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    received += decoder.decode(chunk.value, { stream: true });
  }
  assert.equal(received.includes('[DONE]'), false, 'The first text must arrive while the turn is still running');
  const firstEvent = received.split('\n').find(line => line.includes('"delta"'))!;
  const partial = JSON.parse(firstEvent.slice(6)).delta.text;
  assert.ok(partial.length > 0 && partial.length < '命宫主星：武曲、天府。'.length);
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += decoder.decode(chunk.value, { stream: true });
  }
  reader.releaseLock();
  assert.equal(await reply(new Response(received)), '命宫主星：武曲、天府。');
  assert.equal(received.includes('INTERNAL_REASONING_DO_NOT_DISPLAY'), false);
});

test('final-only snapshots remain readable without duplicate text', async () => {
  assert.equal(await reply(codexResponse('__FINAL_ONLY__', new AbortController().signal)), '命宫主星：武曲、天府。');
});

test('protocol filters other turns and emits only the missing final suffix', () => {
  const sent: object[] = []; const chunks: string[] = []; let completed = false;
  const protocol = new CodexProtocol({
    prompt: '解读', cwd: process.cwd(), model: 'configured-model', effort: 'medium',
    send: message => sent.push(message), onText: text => chunks.push(text),
    onComplete: () => { completed = true; }, onError: details => assert.fail(details),
  });
  protocol.start();
  protocol.receive({ id: 1, result: {} });
  protocol.receive({ id: 2, result: { thread: { id: 'thread-1' } } });
  protocol.receive({ id: 3, result: { turn: { id: 'turn-1' } } });
  protocol.receive({ method: 'item/agentMessage/delta', params: { threadId: 'other-thread', turnId: 'turn-1', itemId: 'a', delta: 'wrong' } });
  protocol.receive({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'other-turn', itemId: 'a', delta: 'wrong' } });
  protocol.receive({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'a', delta: '命宫' } });
  protocol.receive({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', id: 'a', text: '命宫主星' } } });
  protocol.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  assert.deepEqual(chunks, ['命宫', '主星']);
  assert.equal(completed, true);
  assert.equal((sent[2] as { params: { ephemeral: boolean } }).params.ephemeral, true);
});

test('a failed streamed turn preserves its partial output and is never reported as successful', () => {
  const chunks: string[] = []; const errors: string[] = []; let completed = false;
  const protocol = new CodexProtocol({
    prompt: '解读', cwd: process.cwd(), send: () => {}, onText: text => chunks.push(text),
    onComplete: () => { completed = true; }, onError: details => errors.push(details),
  });
  protocol.receive({ id: 1, result: {} });
  protocol.receive({ id: 2, result: { thread: { id: 'thread-1' } } });
  protocol.receive({ id: 3, result: { turn: { id: 'turn-1' } } });
  protocol.receive({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'a', delta: '已生成的解读' } });
  protocol.receive({ method: 'error', params: { threadId: 'thread-1', turnId: 'turn-1', willRetry: true, error: { message: 'temporary connection issue' } } });
  assert.equal(errors.length, 0);
  protocol.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'failed', error: { message: 'connection failed' } } } });
  assert.deepEqual(chunks, ['已生成的解读']);
  assert.deepEqual(errors, ['connection failed']);
  assert.equal(completed, false);
});

test('timeout terminates the job and releases its request slot', async () => {
  process.env.CODEX_TIMEOUT_MS = '100';
  try {
    await assert.rejects(reply(codexResponse('__WAIT__', new AbortController().signal)), /超时/);
  } finally { process.env.CODEX_TIMEOUT_MS = '10000'; }
  assert.match(await reply(codexResponse('再试一次', new AbortController().signal)), /命宫/);
});

test('request abort closes the stream and releases its slot', async () => {
  const controller = new AbortController();
  const response = codexResponse('__WAIT__', controller.signal);
  const output = response.text();
  controller.abort();
  await output;
  assert.match(await reply(codexResponse('再次解读', new AbortController().signal)), /天府/);
});

test('a cancelled response stops work and does not retain the concurrency slot', async () => {
  const response = codexResponse('__WAIT__', new AbortController().signal);
  await response.body!.cancel();
  assert.match(await reply(codexResponse('再次解读', new AbortController().signal)), /天府/);
});

test('at most two CLI requests can be active', async () => {
  const first = new AbortController();
  const second = new AbortController();
  const responses = [codexResponse('__WAIT__', first.signal), codexResponse('__WAIT__', second.signal)];
  assert.throws(() => codexResponse('third', new AbortController().signal), (error: unknown) => error instanceof LocalAIError && error.status === 429);
  first.abort(); second.abort();
  await Promise.all(responses.map(response => response.text()));
});

test('untrusted external origins cannot invoke the local CLI', async () => {
  const response = await handleInterpretation(request({ chart, messages: [{ role: 'user', content: '分析' }] }, 'https://example.com'));
  assert.equal(response.status, 403);
});

test('invalid dates are rejected before invoking the CLI', async () => {
  const response = await handleInterpretation(request({ chart: { birthInfo: { ...chart.birthInfo, month: 2, day: 30 } }, messages: [{ role: 'user', content: '分析' }] }));
  assert.equal(response.status, 400);
});

test('versioned lunar input reaches AI with one time conversion and survives server reconstruction', async () => {
  const birthInfo=formToBirthInfo({name:'农历验收',year:'2023',month:'2',day:'1',calendar:'lunar',isLeapMonth:true,clockHour:'23',clockMinute:'30',unknownTime:false,province:'',city:'',longitude:120,gender:'male'});
  const response=await handleInterpretation(request({chart:{birthInfo},messages:[{role:'user',content:'__CONTEXT__'}]}));
  assert.equal(response.status,200);
  const task=JSON.parse(await reply(response));
  assert.deepEqual(task.chart.birthInfo,JSON.parse(JSON.stringify({...birthInfo,leapMonthPolicy:'split'})));
  const bad=await handleInterpretation(request({chart:{birthInfo:{...birthInfo,hour:6}},messages:[{role:'user',content:'分析'}]}));
  assert.equal(bad.status,400);
});

test('a same-origin browser using 127.0.0.1 is accepted when Next normalizes its URL to localhost', async () => {
  const localRequest = new Request('http://localhost:3100/api/interpret', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Host: '127.0.0.1:3100', Origin: 'http://127.0.0.1:3100' },
    body: JSON.stringify({ chart, messages: [{ role: 'user', content: '分析' }] }),
  });
  const response = await handleInterpretation(localRequest);
  assert.equal(response.status, 200);
  assert.match(await reply(response), /武曲/);
});

test('an external Host header is rejected even if Next uses a local internal URL', async () => {
  const externalRequest = new Request('http://localhost:3100/api/interpret', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'example.com', Origin: 'http://example.com' },
    body: JSON.stringify({ chart, messages: [{ role: 'user', content: '分析' }] }),
  });
  assert.equal((await handleInterpretation(externalRequest)).status, 403);
});

test('oversized requests are rejected', async () => {
  const response = await handleInterpretation(request({ extra: 'x'.repeat(200000) }));
  assert.equal(response.status, 413);
});

test('server rebuilds the chart and carries prior conversation instead of accepting forged stars', async () => {
  const messages = [{ role: 'user', content: '先谈性格' }, { role: 'assistant', content: '前一次回答' }, { role: 'user', content: '__CONTEXT__' }];
  const response = await handleInterpretation(request({ chart: { ...chart, palaces: [{ name: '伪造宫位' }] }, messages }));
  const task = JSON.parse(await reply(response));
  assert.equal(task.chart.palaces.length, 12);
  assert.equal(task.chart.palaces.some((palace: { name: string }) => palace.name === '伪造宫位'), false);
  assert.deepEqual(task.messages, messages);
  assert.ok(Array.isArray(task.patterns));
  assert.equal(task.readingMode,'professional');
});

test('plain reading gets its own conversation and sanitized saved professional reference', async()=>{
  const messages=[{role:'user',content:'用人话说明 __CONTEXT__'}];
  for(const comparison of[false,true]){
    const task=JSON.parse(await reply(await handleInterpretation(request({...(comparison?{chartA:chart,chartB:chart}:{chart}),readingMode:'plain',professionalReference:{text:'专业结论[资料7](https://example.com)\n\n**【本次检索资料】**\n旧出处',phase:'interrupted'},messages}),comparison)));
    assert.equal(task.readingMode,'plain');assert.deepEqual(task.messages,messages);
    assert.deepEqual(task.professionalReference,{text:'专业结论',phase:'interrupted'});
    assert.ok(task.knowledge);if(comparison){assert.ok(task.chartA);assert.ok(task.chartB);}
  }
});
test('invalid reading modes and malformed professional references never invoke CLI',async()=>{
  for(const body of[{readingMode:'unknown'},{readingMode:'plain',professionalReference:{text:'x'.repeat(12001),phase:'complete'}},{readingMode:'plain',professionalReference:{text:'x',phase:'unknown'}},{readingMode:'plain',professionalReference:[] }]){
    assert.equal((await handleInterpretation(request({chart,messages:[{role:'user',content:'解释'}],...body}))).status,400);
  }
});
test('plain instructions require everyday prose while professional instructions stay intact',async()=>{
  const body={chart,messages:[{role:'user',content:'__PROMPT__'}]};
  const professional=await reply(await handleInterpretation(request(body)));
  const plain=await reply(await handleInterpretation(request({...body,readingMode:'plain'})));
  assert.ok(professional.includes('准确引用宫位、主星、亮度、四化、当前年龄及大限'));
  assert.ok(!professional.includes('专业词集中在【术语翻译】'));
  assert.ok(!plain.includes('准确引用宫位、主星、亮度、四化、当前年龄及大限'));
  assert.ok(plain.includes('前两节和建议只用日常表达'));assert.ok(plain.includes('最多两三个'));assert.ok(plain.includes('部分旧资料与当前排盘不一致，这里未采用'));
});

test('comparison endpoint provides two independent chart contexts', async () => {
  const response = await handleInterpretation(request({ chartA: chart, chartB: { birthInfo: { ...chart.birthInfo, gender: 'female' } }, question: '__CONTEXT__' }), true);
  const task = JSON.parse(await reply(response));
  assert.equal(task.chartA.chart.birthInfo.gender, 'male');
  assert.equal(task.chartB.chart.birthInfo.gender, 'female');
});

test('comparison follow-ups carry prior answers and use the latest question for retrieval', async () => {
  const messages = [{ role: 'user', content: '先分析相处' }, { role: 'assistant', content: '之前的合盘结果[资料1]' }, { role: 'user', content: '事业合作 __CONTEXT__' }];
  const response = await handleInterpretation(request({ chartA: chart, chartB: { birthInfo: { ...chart.birthInfo, gender: 'female' } }, messages }), true);
  const task = JSON.parse(await reply(response)); assert.deepEqual(task.messages, messages);
  assert.equal(task.question, messages[2].content); assert.ok(task.knowledge.topics.includes('career'));
  assert.equal((await handleInterpretation(request({ chartA: chart, chartB: chart, messages: [{ role: 'assistant', content: '不能由助手结束' }] }), true)).status, 400);
});

test('client preserves split UTF-8, split JSON, status and completion events', async () => {
  const bytes = new TextEncoder().encode('data: {"status":"等待中"}\n\ndata: {"delta":{"text":"中文解读"}}\n\ndata: [DONE]\n\n');
  const response = new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index += 2) controller.enqueue(bytes.subarray(index, index + 2));
    controller.close();
  } }));
  let text = ''; let status = '';
  await readAIStream(response, value => { text = value; }, value => { status = value; });
  assert.equal(text, '中文解读');
  assert.equal(status, '等待中');
});

test('client reports a truncated response instead of silently accepting it', async () => {
  const response = new Response('data: {"delta":{"text":"部分回答"}}\n\n');
  await assert.rejects(reply(response), /连接中断/);
});
