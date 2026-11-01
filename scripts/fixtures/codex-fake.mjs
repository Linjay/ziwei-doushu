import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

let writes = Promise.resolve();
function send(message) {
  // Serialize fragmented lines so separate RPC messages cannot interleave.
  writes = writes.then(async () => {
    const bytes = Buffer.from(JSON.stringify(message) + '\n');
    const chinese = bytes.indexOf(Buffer.from('宫'));
    const cut = chinese >= 0 ? chinese + 1 : Math.min(30, bytes.length);
    process.stdout.write(bytes.subarray(0, cut));
    await delay(2);
    process.stdout.write(bytes.subarray(cut));
  });
}

const threadId = 'thread-test';
const turnId = 'turn-test';
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    send({ id: request.id, result: { userAgent: 'fake-codex' } });
  } else if (request.method === 'thread/start') {
    if (request.params.sandbox !== 'read-only' || request.params.approvalPolicy !== 'never' || !request.params.ephemeral) {
      send({ id: request.id, error: { code: -32602, message: 'Expected read-only ephemeral thread' } });
      return;
    }
    send({ id: request.id, result: { thread: { id: threadId } } });
  } else if (request.method === 'turn/start') {
    const prompt = request.params.input[0].text;
    if (prompt.includes('__WAIT__')) { setInterval(() => {}, 1000); return; }
    if (prompt.includes('__AUTH_ERROR__')) {
      send({ id: request.id, error: { code: -32000, message: '401 authentication token expired' } });
      return;
    }
    let text = '命宫主星：武曲、天府。';
    if (prompt.includes('"readingMode":"plain"')) text = '**【先说人话】**\n通俗示例：遇到事情，可能更习惯先自己想清楚。\n\n**【放到生活里】**\n例如，合作时可以先说明自己的想法，这只是帮助理解的场景。\n\n**【术语翻译】**\n命宫：排盘中用来讨论个人特点的位置。\n\n**【可以尝试】**\n有分歧时先问问对方的看法。';
    if (prompt.includes('__MOBILE_SCROLL__')) text = '**【移动阅读验收】**\n' + Array.from({ length: 40 }, (_, index) => `第 ${index + 1} 段：这是一段专用于验证长文滚动的示例文字。读者向上查看时，新内容不应把视图拉回底部。\n\n`).join('');
    if (prompt.includes('__CONTEXT__')) text = prompt.slice(prompt.indexOf('任务 JSON：\n') + '任务 JSON：\n'.length);
    if (prompt.includes('__PROMPT__')) text = prompt;
    send({ id: request.id, result: { turn: { id: turnId, status: 'inProgress' } } });
    send({ method: 'item/reasoning/textDelta', params: { threadId, turnId, delta: 'INTERNAL_REASONING_DO_NOT_DISPLAY' } });
    const characters = Array.from(text);
    const split = Math.ceil(characters.length / 3);
    if (!prompt.includes('__FINAL_ONLY__')) {
      for (let index = 0; index < 3; index++) {
        setTimeout(() => send({
          method: 'item/agentMessage/delta',
          params: { threadId, turnId, itemId: 'message-1', delta: characters.slice(index * split, (index + 1) * split).join('') },
        }), index * (prompt.includes('__PAIR_SLOW__') ? 1000 : 30));
      }
    }
    setTimeout(() => {
      const completed = { method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', id: 'message-1', text } } };
      send(completed);
      send(completed); // Repeated snapshots must not duplicate streamed text.
      send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
    }, prompt.includes('__PAIR_SLOW__') ? 3500 : prompt.includes('__SLOW_STREAM__') ? 350 : 100);
  }
});
