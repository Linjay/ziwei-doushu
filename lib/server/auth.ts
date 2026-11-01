import 'server-only';
import { randomBytes, randomInt, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { database } from './database';
import { checkOrigin, HttpError } from './http';
import { beijingDate, emptyProfile, type AccountUser, type PersonalProfile } from '../account';

const COOKIE = 'mingli_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function passwordHash(password: string) {
  if (password.length < 10 || password.length > 128) throw new HttpError('密码需为 10–128 个字符。');
  return encodePassword(password);
}
async function encodePassword(password: string) {
  const salt = randomBytes(24).toString('hex');
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function passwordMatches(password: string, stored: string) {
  const [, salt, expected] = stored.split('$');
  if (!salt || !expected || password.length > 128) return false;
  const actual = await derive(password, salt); const decoded = Buffer.from(expected, 'hex');
  return decoded.length === actual.length && timingSafeEqual(actual, decoded);
}
export function publicUser(row: Record<string, unknown>): AccountUser {
  return { id: String(row.id), username: String(row.username), createdAt: Number(row.created_at), profile: JSON.parse(String(row.profile)), isGuest: Number(row.is_guest) === 1, usesInitialPassword: Number(row.initial_password) === 1 };
}
function cookieToken(request: Request) {
  const token = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export function currentUser(request: Request) {
  const token = cookieToken(request); if (!token) return null;
  const row = database().prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(hash(token), Date.now());
  return row ? publicUser(row) : null;
}
export function requireUser(request: Request) {
  const user = currentUser(request);
  if (!user) throw new HttpError('请先登录后继续。', 401);
  return user;
}
export function createSession(userId: string, request: Request, deviceId?: string) {
  const db = database(); const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,device_id) VALUES(?,?,?,?)').run(hash(token), userId, Date.now() + SESSION_SECONDS * 1000, deviceId || null);
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${checkOrigin(request).startsWith('https:') ? '; Secure' : ''}`;
}
export function endSession(request: Request) {
  const token = cookieToken(request);
  if (token) database().prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${checkOrigin(request).startsWith('https:') ? '; Secure' : ''}`;
}
export function rateLimit(key: string, limit: number, windowMs: number) {
  const db = database(); const now = Date.now(); const bucket = hash(key);
  db.prepare('DELETE FROM rate_limits WHERE reset_at<=?').run(now);
  const row = db.prepare(`INSERT INTO rate_limits(bucket,attempts,reset_at) VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET attempts=rate_limits.attempts+1 RETURNING attempts`).get(bucket, now + windowMs);
  if (Number(row?.attempts) > limit) throw new HttpError('操作过于频繁，请稍后再试。', 429);
}
export async function registerUser(value: Record<string, unknown>) {
  const username = typeof value.username === 'string' ? value.username.trim().toLowerCase() : '';
  if (!/^[a-z0-9_]{3,32}$/.test(username)) throw new HttpError('账号需为 3–32 位英文字母、数字或下划线。');
  if (typeof value.password !== 'string') throw new HttpError('请输入密码。');
  const displayName = typeof value.displayName === 'string' ? value.displayName.trim().slice(0, 40) : '';
  const password = await passwordHash(value.password);
  const id = randomUUID(); const now = Date.now();
  try { database().prepare('INSERT INTO users(id,username,password_hash,profile,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, username, password, JSON.stringify(emptyProfile(displayName || username)), now, now); }
  catch (error) { if (String(error).includes('UNIQUE')) throw new HttpError('这个账号已被注册，请换一个。', 409); throw error; }
  return publicUser(database().prepare('SELECT * FROM users WHERE id=?').get(id)!);
}
export const GUEST_INITIAL_PASSWORD = '12345678';
const GUEST_NAMES = ['oliver','amelia','ethan','sophia','noah','emma','leo','ava','lucas','mia','oscar','lily','henry','ella','felix','alice','james','ruby','jack','clara','owen','grace','liam','rose'];
export async function registerGuest() {
  const db = database();
  const encoded = await encodePassword(GUEST_INITIAL_PASSWORD);
  for (let attempt = 0; attempt < 8; attempt++) {
    const suffix = Array.from({ length: 7 }, () => String.fromCharCode(97 + randomInt(26))).join('');
    const username = `guest_${GUEST_NAMES[randomInt(GUEST_NAMES.length)]}_${suffix}`;
    const id = randomUUID(), now = Date.now();
    const result = db.prepare('INSERT OR IGNORE INTO users(id,username,password_hash,profile,created_at,updated_at,is_guest,initial_password) VALUES(?,?,?,?,?,?,1,1)').run(id,username,encoded,JSON.stringify(emptyProfile(username)),now,now);
    if (result.changes === 1) return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)!);
  }
  throw new HttpError('暂时无法分配账号，请再试一次。', 503);
}
export async function loginUser(value: Record<string, unknown>) {
  const username = typeof value.username === 'string' ? value.username.trim().toLowerCase().slice(0, 32) : '';
  const password = typeof value.password === 'string' ? value.password : '';
  rateLimit(`login:${username}`, 12, 15 * 60 * 1000);
  const row = database().prepare('SELECT * FROM users WHERE username=?').get(username);
  // Perform the same expensive KDF for unknown users to avoid a timing shortcut.
  const valid = await passwordMatches(password, row ? String(row.password_hash) : `scrypt$${'0'.repeat(48)}$${'0'.repeat(128)}`);
  if (!row || !valid) throw new HttpError('账号或密码不正确。', 401);
  database().prepare('DELETE FROM rate_limits WHERE bucket=?').run(hash(`login:${username}`));
  return publicUser(row);
}
export function validateProfile(value: Record<string, unknown>): PersonalProfile {
  const profile = emptyProfile();
  for (const [key, max] of [['displayName', 40], ['birthday', 10], ['birthTime', 5], ['city', 80], ['bio', 300]] as const) {
    if (typeof value[key] !== 'string' || value[key].length > max) throw new HttpError('个人资料格式不正确。');
    profile[key] = value[key].trim();
  }
  if (!profile.displayName) throw new HttpError('请填写昵称。');
  if (profile.birthday) {
    const date = new Date(`${profile.birthday}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.birthday) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== profile.birthday || profile.birthday < '1900-01-01' || profile.birthday > beijingDate()) throw new HttpError('出生日期不正确。');
  }
  if (profile.birthTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(profile.birthTime)) throw new HttpError('出生时间不正确。');
  if (!['', 'male', 'female'].includes(String(value.gender))) throw new HttpError('性别格式不正确。');
  profile.gender = value.gender as PersonalProfile['gender'];
  return profile;
}
