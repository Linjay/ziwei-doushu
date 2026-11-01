import { requireUser, validateProfile, passwordHash, passwordMatches, publicUser } from '@/lib/server/auth';
import { revokeUserDevices, sessionHeaders } from '@/lib/server/device-auth';
import { database, transaction } from '@/lib/server/database';
import { readJson, jsonResponse, errorResponse, HttpError } from '@/lib/server/http';

export const runtime = 'nodejs';
export async function PATCH(request: Request) {
  try {
    const body = await readJson(request); const user = requireUser(request);
    const profile = validateProfile(body);
    database().prepare('UPDATE users SET profile=?,updated_at=? WHERE id=?').run(JSON.stringify(profile), Date.now(), user.id);
    return jsonResponse({ user: { ...user, profile } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const body = await readJson(request); const user = requireUser(request); const db = database();
    const { rateLimit } = await import('@/lib/server/auth');
    rateLimit(`password:${user.id}`, 8, 15 * 60 * 1000);
    if (typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') throw new HttpError('请填写当前密码和新密码。');
    const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id)!;
    if (!await passwordMatches(body.currentPassword, String(row.password_hash))) throw new HttpError('当前密码不正确。', 401);
    const encoded = await passwordHash(body.newPassword);
    transaction(() => {
      db.prepare('UPDATE users SET password_hash=?,initial_password=0,updated_at=? WHERE id=?').run(encoded, Date.now(), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      revokeUserDevices(user.id);
    });
    const updated = publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)!);
    return jsonResponse({ ok:true, user:updated },200,sessionHeaders(updated,request));
  } catch (error) { return errorResponse(error); }
}
