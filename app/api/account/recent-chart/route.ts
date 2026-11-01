import { requireUser } from '@/lib/server/auth';
import { recentAccountChart } from '@/lib/server/account-history';
import { checkOrigin, jsonResponse, errorResponse } from '@/lib/server/http';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    checkOrigin(request,false);
    return jsonResponse({recordId:recentAccountChart(requireUser(request).id)});
  } catch (error) { return errorResponse(error); }
}
