import { requireUser } from '@/lib/server/auth';
import { deleteAccountRecord } from '@/lib/server/account-history';
import { checkOrigin, jsonResponse, errorResponse } from '@/lib/server/http';

export const runtime = 'nodejs';
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request); const user = requireUser(request);
    deleteAccountRecord(user.id, (await context.params).id);
    return jsonResponse({ ok: true });
  } catch (error) { return errorResponse(error); }
}
