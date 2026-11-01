import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { database, transaction } from './database';
import { createSession, currentUser, endSession, publicUser, rateLimit } from './auth';
import { checkOrigin, HttpError } from './http';
import type { AccountUser, RememberedAccount } from '../account';

const COOKIE = 'mingli_device';
const DEVICE_SECONDS = 365 * 24 * 60 * 60;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function tokenOf(request: Request) {
  const token = request.headers.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
function cookie(request: Request, token = '') {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? DEVICE_SECONDS : 0}${checkOrigin(request).startsWith('https:') ? '; Secure' : ''}`;
}
function currentDevice(request: Request) {
  const token = tokenOf(request);
  if (!token) return null;
  return database().prepare('SELECT id,active_user_id FROM remembered_devices WHERE token_hash=? AND expires_at>?').get(digest(token),Date.now()) || null;
}
export function deviceState(request: Request) {
  const device = currentDevice(request);
  const accounts: RememberedAccount[] = device ? database().prepare('SELECT u.id,u.username,u.profile FROM device_accounts a JOIN users u ON u.id=a.user_id WHERE a.device_id=? ORDER BY a.last_used_at DESC,u.id').all(device.id).map(row => ({ id:String(row.id),username:String(row.username),displayName:JSON.parse(String(row.profile)).displayName })) : [];
  return { accounts, autoResume: !!device?.active_user_id && accounts.some(account => account.id === device.active_user_id) };
}
/** Independent opaque device token: no password or credential is exposed to JavaScript. */
export function sessionHeaders(user: AccountUser, request: Request): Headers {
  const db = database(), existing = currentDevice(request);
  const token = existing ? tokenOf(request)! : randomBytes(32).toString('hex');
  const id = existing ? String(existing.id) : randomUUID();
  transaction(() => {
    db.prepare('DELETE FROM remembered_devices WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO remembered_devices(id,token_hash,active_user_id,expires_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET active_user_id=excluded.active_user_id,expires_at=excluded.expires_at').run(id,digest(token),user.id,Date.now()+DEVICE_SECONDS*1000);
    db.prepare('INSERT INTO device_accounts(device_id,user_id,last_used_at) VALUES(?,?,?) ON CONFLICT(device_id,user_id) DO UPDATE SET last_used_at=excluded.last_used_at').run(id,user.id,Date.now());
  });
  const headers = new Headers();
  headers.append('Set-Cookie',createSession(user.id,request,id));
  headers.append('Set-Cookie',cookie(request,token));
  return headers;
}
export function loginFromDevice(request: Request, userId?: unknown) {
  const device = currentDevice(request);
  if (userId !== undefined && (typeof userId !== 'string' || !/^[a-f0-9-]{36}$/.test(userId))) throw new HttpError('请选择这台设备使用过的账号。');
  if (!device) throw new HttpError('设备登录已失效，请使用账号密码登录。',401);
  const target = userId || device.active_user_id;
  rateLimit(`device-login:${device.id}`,120,60*60*1000);
  const row = target && database().prepare('SELECT u.* FROM device_accounts a JOIN users u ON u.id=a.user_id WHERE a.device_id=? AND a.user_id=?').get(device.id,target);
  if (!row) throw new HttpError('此账号未保存在当前设备，请使用账号密码登录。',401);
  return publicUser(row);
}
export function logoutDevice(request: Request, forget = false): Headers {
  const db = database(), device = currentDevice(request);
  if (device) {
    db.prepare('DELETE FROM sessions WHERE device_id=?').run(device.id);
    if (forget) db.prepare('DELETE FROM remembered_devices WHERE id=?').run(device.id);
    else db.prepare('UPDATE remembered_devices SET active_user_id=NULL WHERE id=?').run(device.id);
  }
  const headers = new Headers({ 'Set-Cookie':endSession(request) });
  if (forget) headers.append('Set-Cookie',cookie(request));
  return headers;
}
export function forgetDeviceAccount(request: Request, userId: unknown) {
  const device = currentDevice(request), db = database();
  if (typeof userId !== 'string' || !/^[a-f0-9-]{36}$/.test(userId)) throw new HttpError('请选择要移除的设备账号。');
  const signedIn = currentUser(request);
  if (device) transaction(() => {
    db.prepare('DELETE FROM device_accounts WHERE device_id=? AND user_id=?').run(device.id,userId);
    db.prepare('DELETE FROM sessions WHERE device_id=? AND user_id=?').run(device.id,userId);
    db.prepare('UPDATE remembered_devices SET active_user_id=NULL WHERE id=? AND active_user_id=?').run(device.id,userId);
  });
  return { signedOut: signedIn?.id === userId && !!device, ...deviceState(request) };
}
/** Password changes revoke all remembered access to that account; the current device is then re-enrolled. */
export function revokeUserDevices(userId: string) {
  const db = database();
  db.prepare('DELETE FROM device_accounts WHERE user_id=?').run(userId);
  db.prepare('UPDATE remembered_devices SET active_user_id=NULL WHERE active_user_id=?').run(userId);
}
