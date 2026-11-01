import 'server-only';

export class HttpError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function allowedOrigins() {
  return (process.env.APP_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean).map(value => new URL(value).origin);
}
export function checkOrigin(request: Request, mutation = true) {
  const url = new URL(request.url);
  const host = (request.headers.get('host') || url.host).toLowerCase();
  const origins = allowedOrigins();
  const hostname = new URL(`http://${host}`).hostname;
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  if (!(origins.length ? origins.some(value => new URL(value).host.toLowerCase() === host) : loopback)) {
    throw new HttpError('当前访问地址未获允许，请使用配置好的站点入口。', 403);
  }
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError('请从本站页面发起请求。', 403);
  if (!origin) {
    if (mutation) throw new HttpError('请求缺少来源信息，请刷新页面后重试。', 403);
    return url.origin;
  }
  let source: URL;
  try { source = new URL(origin); } catch { throw new HttpError('请求来源不正确。', 403); }
  if (!['http:', 'https:'].includes(source.protocol) || source.origin !== origin || source.host.toLowerCase() !== host
      || (origins.length && !origins.includes(source.origin))) {
    throw new HttpError('请从本站页面发起请求。', 403);
  }
  return source.origin;
}
export async function readJson(request: Request, maxBytes = 32 * 1024): Promise<Record<string, unknown>> {
  checkOrigin(request);
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError('请求必须使用 JSON。', 415);
  if (Number(request.headers.get('content-length') || 0) > maxBytes) throw new HttpError('请求内容过长。', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError('请求内容为空。');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      length += item.value.length;
      if (length > maxBytes) { await reader.cancel(); throw new HttpError('请求内容过长。', 413); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError('JSON 内容不正确。'); }
}
export function jsonResponse(value: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'private, no-store');
  return Response.json(value, { status, headers: responseHeaders });
}
export function errorResponse(error: unknown) {
  if (!(error instanceof HttpError)) console.error('Account request failed:', error instanceof Error ? error.message : 'unknown');
  return jsonResponse({ error: { message: error instanceof HttpError ? error.message : '服务暂时不可用，请稍后重试。' } }, error instanceof HttpError ? error.status : 500);
}
