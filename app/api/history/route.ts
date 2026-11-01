import { requireUser } from '@/lib/server/auth';
import { readAccountHistory, saveAccountHistory, deletedRecordIds } from '@/lib/server/account-history';
import { checkOrigin, readJson, jsonResponse, errorResponse } from '@/lib/server/http';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try { checkOrigin(request, false); const user = requireUser(request); return jsonResponse({ history: readAccountHistory(user.id), deletedIds: deletedRecordIds(user.id) }); }
  catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    const user = requireUser(request);
    const body = await readJson(request, 20 * 1024 * 1024);
    const restore = body.restore === true;
    return jsonResponse({ history: saveAccountHistory(user.id, restore ? body.history : body, restore), deletedIds: deletedRecordIds(user.id) });
  } catch (error) { return errorResponse(error); }
}
