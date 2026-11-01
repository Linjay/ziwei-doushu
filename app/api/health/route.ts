import { database } from '@/lib/server/database';
import { knowledgeStatus } from '@/lib/server/knowledge';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() {
  try { database().prepare('SELECT 1').get(); const knowledge = knowledgeStatus(); return Response.json({ status: 'ok', version: process.env.APP_VERSION || 'local', knowledge: { status: knowledge.status, mode: knowledge.mode } }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ status: 'unavailable' }, { status: 503 }); }
}
