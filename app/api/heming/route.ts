import { handleInterpretation } from '@/lib/server/interpretation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleInterpretation(request, true);
}
