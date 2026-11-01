import { requireUser } from '@/lib/server/auth';
import { HttpError } from '@/lib/server/http';
import { getKnowledgeSource, knowledgeStatus, KnowledgeError } from '@/lib/server/knowledge';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  try {
    requireUser(request);
    const ref = new URL(request.url).searchParams.get('ref');
    const data = ref === null ? knowledgeStatus() : ref.length <= 120 ? getKnowledgeSource(ref) : null;
    if (!data) return Response.json({ error: { message: '未找到该资料，或当前使用模式不允许查看。' } }, { status: 404 });
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: { message: error instanceof HttpError || error instanceof KnowledgeError ? error.message : '资料读取失败。' } },
      { status: error instanceof HttpError ? error.status : 503 });
  }
}
