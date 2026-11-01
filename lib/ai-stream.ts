/** Read SSE lines with buffering: a JSON event may span multiple network chunks. */
export async function readAIStream(
  response: Response,
  onText: (text: string) => void,
  onStatus?: (status: string) => void,
): Promise<void> {
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error?.message || `解读请求失败（${response.status}）。`);
  }
  if (!response.body) throw new Error('解读服务没有返回内容。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let doneEvent = false;
  const line = (value: string) => {
    if (!value.startsWith('data: ')) return;
    const data = value.slice(6).trim();
    if (data === '[DONE]') { doneEvent = true; return; }
    let event;
    try { event = JSON.parse(data); } catch { throw new Error('解读响应格式不正确，请重试。'); }
    if (event.error) throw new Error(event.error.message || '解读执行失败。');
    if (typeof event.status === 'string') onStatus?.(event.status);
    if (typeof event.delta?.text === 'string') { text += event.delta.text; onText(text); }
  };
  try {
    while (!doneEvent) {
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, newline).replace(/\r$/, ''));
        buffer = buffer.slice(newline + 1);
        if (doneEvent) break;
      }
      if (chunk.done) { if (buffer.trim()) line(buffer.trim()); break; }
    }
    if (!doneEvent) throw new Error('解读连接中断，请重试。');
    if (!text.trim()) throw new Error('Codex 未返回解读内容，请重试。');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
