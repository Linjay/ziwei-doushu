import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { POST as authPost, GET as authGet } from '../app/api/auth/[action]/route';
import { GET as getHistory, PUT as putHistory } from '../app/api/history/route';
import { GET as getRecentChart } from '../app/api/account/recent-chart/route';
import { DELETE as deleteRecord } from '../app/api/history/[id]/route';
import { PATCH as patchAccount, POST as changePassword } from '../app/api/account/route';
import { database } from '../lib/server/database';
import { currentUser, rateLimit } from '../lib/server/auth';
import { handleInterpretation } from '../lib/server/interpretation';
import { addChartRecord, addComparisonRecord, emptyHistory, updateRecordInsight } from '../lib/chart-history';
import { generateChart } from '../lib/ziwei/algorithm';
import { projectComparison, projectInsight } from '../lib/insight-topics';

const base = path.resolve('.codex-local'); mkdirSync(base, { recursive: true });
const directory = mkdtempSync(path.join(base, 'account-tests-'));
process.env.MINGLI_DATA_DIR = directory;
process.env.APP_ALLOWED_ORIGINS = 'http://127.0.0.1:3100,https://mingli.linjay.fun:16666';
process.env.AUTH_REQUIRED = 'true';
const origin = 'http://127.0.0.1:3100';
const context = (action: string) => ({ params: Promise.resolve({ action }) });
function request(url: string, method = 'GET', body?: unknown, cookie?: string, source = origin) {
  return new Request(`${source}${url}`, { method, headers: { Origin: source, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const cookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];
let alice = ''; let bob = ''; let aliceId = ''; let bobId = '';
let saved = addChartRecord(emptyHistory(), generateChart({ year: 1990, month: 6, day: 15, hour: 6, gender: 'male' }), 'chart-alice', 1000);
saved = updateRecordInsight(saved, 'chart-alice', { phase: 'complete', activeTopic: 'overview', messages: [{ role: 'user', content: '我的私人问题' }, { role: 'assistant', content: '只属于 Alice 的命盘解读。' }] }, 2000);
before(async () => {
  const a = await authPost(request('/api/auth/register', 'POST', { username: 'alice', password: 'LongPassword-Alice-2026', displayName: '甲' }), context('register'));
  assert.equal(a.status, 201); alice = cookie(a); aliceId = (await a.json()).user.id;
  const b = await authPost(request('/api/auth/register', 'POST', { username: 'bob', password: 'LongPassword-Bob-2026' }), context('register'));
  assert.equal(b.status, 201); bob = cookie(b); bobId = (await b.json()).user.id;
});
after(() => {
  database().close();
  if (path.dirname(directory) !== base || !path.basename(directory).startsWith('account-tests-')) throw new Error('Unsafe test cleanup path');
  rmSync(directory, { recursive: true, force: true });
});
test('registration creates private sessions and never stores raw passwords or tokens', () => {
  const row = database().prepare('SELECT password_hash FROM users WHERE id=?').get(aliceId)!;
  assert.match(String(row.password_hash), /^scrypt\$/); assert.ok(!String(row.password_hash).includes('LongPassword'));
  assert.equal(database().prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(alice.split('=')[1]), undefined);
  assert.equal(currentUser(request('/api/auth/me', 'GET', undefined, alice))!.username, 'alice');
});
test('registration validates passwords and case-insensitive duplicate usernames', async () => {
  assert.equal((await authPost(request('/api/auth/register', 'POST', { username: 'ALICE', password: 'LongPassword-Other-2026' }), context('register'))).status, 409);
  assert.equal((await authPost(request('/api/auth/register', 'POST', { username: 'invalid name', password: 'short' }), context('register'))).status, 400);
  assert.equal((await authPost(request('/api/auth/register', 'POST', { username: 'carol', password: 'short' }), context('register'))).status, 400);
});
test('login rejects wrong passwords and issues secure HttpOnly cookies behind HTTPS', async () => {
  assert.equal((await authPost(request('/api/auth/login', 'POST', { username: 'alice', password: 'wrong' }), context('login'))).status, 401);
  const response = await authPost(request('/api/auth/login', 'POST', { username: 'ALICE', password: 'LongPassword-Alice-2026' }, undefined, 'https://mingli.linjay.fun:16666'), context('login'));
  assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax;.*Secure/);
  assert.equal((await response.json()).user.username, 'alice');
});
test('anonymous visitors cannot read histories or invoke Codex', async () => {
  assert.equal((await getHistory(request('/api/history'))).status, 401);
  assert.equal((await handleInterpretation(request('/api/interpret', 'POST', {}))).status, 401);
});
test('cross-origin writes and spoofed public hosts are rejected', async () => {
  const forged = new Request(`${origin}/api/account`, { method: 'PATCH', headers: { Origin: 'https://evil.example', Cookie: alice, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await patchAccount(forged)).status, 403);
  const missing = new Request(`${origin}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await authPost(missing, context('logout'))).status, 403);
});
test('chart and AI conversations survive a server round trip', async () => {
  const result = await putHistory(request('/api/history', 'PUT', saved, alice));
  assert.equal(result.status, 200);
  const response = await getHistory(request('/api/history', 'GET', undefined, alice));
  assert.deepEqual((await response.json()).history, JSON.parse(JSON.stringify(saved)));
  assert.match(response.headers.get('cache-control')!, /no-store/);
});
test('another account cannot read or delete a private record even with its identifier', async () => {
  assert.equal((await (await getHistory(request('/api/history', 'GET', undefined, bob))).json()).history.records.length, 0);
  assert.equal((await deleteRecord(request('/api/history/chart-alice', 'DELETE', undefined, bob), { params: Promise.resolve({ id: 'chart-alice' }) })).status, 404);
  assert.equal((await (await getHistory(request('/api/history', 'GET', undefined, alice))).json()).history.records.length, 1);
});
test('same imported identifier remains isolated per account and stale saves cannot overwrite newer text', async () => {
  const own = structuredClone(saved); own.records[0].insight.messages = [{ role: 'assistant', content: 'Bob 的独立内容' }];
  assert.equal((await putHistory(request('/api/history', 'PUT', own, bob))).status, 200);
  const stale = structuredClone(saved); stale.records[0].updatedAt = 1500; stale.records[0].insight.messages = [];
  await putHistory(request('/api/history', 'PUT', stale, alice));
  const a = await (await getHistory(request('/api/history', 'GET', undefined, alice))).json();
  const b = await (await getHistory(request('/api/history', 'GET', undefined, bob))).json();
  assert.equal(a.history.records[0].insight.messages[1].content, '只属于 Alice 的命盘解读。');
  assert.equal(b.history.records[0].insight.messages[0].content, 'Bob 的独立内容');
});
test('invalid imports are atomic and preserve existing records', async () => {
  const broken = structuredClone(saved); broken.records.push({ ...broken.records[0], id: 'bad', chart: {} as never });
  assert.equal((await putHistory(request('/api/history', 'PUT', broken, alice))).status, 400);
  assert.equal((await (await getHistory(request('/api/history', 'GET', undefined, alice))).json()).history.records.length, 1);
});
test('profile updates are private and reject impossible birth dates', async () => {
  const profile = { displayName: '新的昵称', birthday: '1990-06-15', birthTime: '12:30', gender: 'male', city: '杭州', bio: '私人备注' };
  assert.equal((await patchAccount(request('/api/account', 'PATCH', profile, alice))).status, 200);
  assert.equal((await patchAccount(request('/api/account', 'PATCH', { ...profile, birthday: '2025-02-30' }, alice))).status, 400);
  assert.equal(currentUser(request('/api/auth/me', 'GET', undefined, bob))!.profile.bio, '');
  assert.equal(currentUser(request('/api/auth/me', 'GET', undefined, alice))!.profile.bio, '私人备注');
});
test('deleted records cannot be resurrected by a stale browser cache', async () => {
  assert.equal((await deleteRecord(request('/api/history/chart-alice', 'DELETE', undefined, alice), { params: Promise.resolve({ id: 'chart-alice' }) })).status, 200);
  const response = await putHistory(request('/api/history', 'PUT', saved, alice));
  const data = await response.json(); assert.equal(data.history.records.length, 0); assert.deepEqual(data.deletedIds, ['chart-alice']);
  assert.equal((await (await getHistory(request('/api/history', 'GET', undefined, bob))).json()).history.records.length, 1);
});
test('password changes revoke all old sessions and retain the current login with a new token', async () => {
  const old = alice;
  const response = await changePassword(request('/api/account', 'POST', { currentPassword: 'LongPassword-Alice-2026', newPassword: 'A-New-Long-Password-2026' }, alice));
  assert.equal(response.status, 200); alice = cookie(response);
  assert.equal(currentUser(request('/api/auth/me', 'GET', undefined, old)), null);
  assert.equal(currentUser(request('/api/auth/me', 'GET', undefined, alice))!.id, aliceId);
});
test('explicit JSON restore can recover a deliberately deleted record', async () => {
  const response = await putHistory(request('/api/history', 'PUT', { history: saved, restore: true }, alice));
  assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.history.records.length, 1); assert.deepEqual(data.deletedIds, []);
});
test('logout and expired tokens stop accessing account data', async () => {
  assert.equal((await authPost(request('/api/auth/logout', 'POST', {}, alice), context('logout'))).status, 200);
  assert.equal((await getHistory(request('/api/history', 'GET', undefined, alice))).status, 401);
  const token = bob.split('=')[1]; database().prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').run(createHash('sha256').update(token).digest('hex'));
  assert.equal(currentUser(request('/api/auth/me', 'GET', undefined, bob)), null);
});
test('persistent rate limits reject excess requests', () => {
  rateLimit('test-limit', 2, 60000); rateLimit('test-limit', 2, 60000);
  assert.throws(() => rateLimit('test-limit', 2, 60000), /频繁/);
});

test('comparisons survive another device, remain private, reject type loss and restore after explicit import', async () => {
  const owner = { username: 'pair_owner', password: 'Pair-Owner-Password-2026' };
  const register = await authPost(request('/api/auth/register', 'POST', owner), context('register')); const session = cookie(register);
  const visitor = cookie(await authPost(request('/api/auth/register', 'POST', { username: 'pair_viewer', password: 'Pair-Viewer-Password-2026' }), context('register')));
  const chartB = generateChart({ year: 1992, month: 8, day: 20, hour: 3, gender: 'female', name: '乙方私密姓名' });
  const history = updateRecordInsight(addComparisonRecord(emptyHistory(), saved.records[0].chart, chartB, 'private-pair', 10), 'private-pair', {
    activeTopic: 'overview', phase: 'complete', messages: [{ role: 'user', content: '两人怎么相处？' }, { role: 'assistant', content: '双方需沟通[资料1]。\n[资料1](/sources?ref=tianji%3A1)' }],
  }, 20);
  assert.equal((await putHistory(request('/api/history', 'PUT', history, session))).status, 200);
  const secondDevice = cookie(await authPost(request('/api/auth/login', 'POST', owner), context('login')));
  assert.deepEqual((await (await getHistory(request('/api/history', 'GET', undefined, secondDevice))).json()).history, JSON.parse(JSON.stringify(history)));
  assert.equal((await (await getHistory(request('/api/history', 'GET', undefined, visitor))).json()).history.records.length, 0);
  assert.equal((await deleteRecord(request('/api/history/private-pair', 'DELETE', undefined, visitor), { params: Promise.resolve({ id: 'private-pair' }) })).status, 404);
  const lostB = JSON.parse(JSON.stringify(history)); delete lostB.records[0].chartB; delete lostB.records[0].kind; lostB.records[0].updatedAt = 30;
  assert.equal((await putHistory(request('/api/history', 'PUT', lostB, session))).status, 400, 'An old client must not turn a saved comparison into a single chart');
  const invalid = JSON.parse(JSON.stringify(history)); invalid.records[0].chartB = {};
  assert.equal((await putHistory(request('/api/history', 'PUT', invalid, session))).status, 400);
  assert.equal((await deleteRecord(request('/api/history/private-pair', 'DELETE', undefined, session), { params: Promise.resolve({ id: 'private-pair' }) })).status, 200);
  assert.equal((await (await putHistory(request('/api/history', 'PUT', history, session))).json()).history.records.length, 0);
  const restored = await (await putHistory(request('/api/history', 'PUT', { history, restore: true }, session))).json();
  assert.deepEqual(restored.history, JSON.parse(JSON.stringify(history)));
});

test('independent topic saves merge on the server and an older page cannot drop topic history', async () => {
  const session = cookie(await authPost(request('/api/auth/register', 'POST', { username: 'topic_owner', password: 'Topic-Owner-Password-2026' }), context('register')));
  const base = addChartRecord(emptyHistory(), saved.records[0].chart, 'topics-private', 1);
  const first = updateRecordInsight(base, 'topics-private', projectInsight({ career: { messages: [{ role: 'assistant', content: '事业结果A' }], phase: 'complete', updatedAt: 20 } }, 'career'), 100);
  assert.equal((await putHistory(request('/api/history', 'PUT', first, session))).status, 200);
  const second = updateRecordInsight(base, 'topics-private', projectInsight({ wealth: { messages: [{ role: 'assistant', content: '财运结果B' }], phase: 'complete', updatedAt: 30 } }, 'wealth'), 90);
  const merged = await (await putHistory(request('/api/history', 'PUT', second, session))).json();
  assert.equal(merged.history.records[0].insight.topics.career.messages[0].content, '事业结果A');
  assert.equal(merged.history.records[0].insight.topics.wealth.messages[0].content, '财运结果B');
  const stale = updateRecordInsight(base, 'topics-private', projectInsight({ career: { messages: [{ role: 'assistant', content: '旧的事业' }], phase: 'complete', updatedAt: 15 } }, 'career'), 200);
  const latest = await (await putHistory(request('/api/history', 'PUT', stale, session))).json();
  assert.equal(latest.history.records[0].insight.topics.career.messages[0].content, '事业结果A');
  const downgraded = updateRecordInsight(base, 'topics-private', { activeTopic: 'career', phase: 'complete', messages: [{ role: 'assistant', content: '旧页面覆盖' }] }, 300);
  assert.equal((await putHistory(request('/api/history', 'PUT', downgraded, session))).status, 400);
  const after = await (await getHistory(request('/api/history', 'GET', undefined, session))).json();
  assert.equal(after.history.records[0].insight.topics.wealth.messages[0].content, '财运结果B');
});

test('home resumes the active single chart or latest single without exposing another account or creating records',async()=>{
  assert.equal((await getRecentChart(request('/api/account/recent-chart'))).status,401);
  assert.match((await getRecentChart(request('/api/account/recent-chart','GET',undefined,bob))).headers.get('cache-control')!,/private, no-store/);
  const session=cookie(await authPost(request('/api/auth/register','POST',{username:'home_resume_owner',password:'Resume-Owner-Password-2026'}),context('register')));
  assert.deepEqual(await (await getRecentChart(request('/api/account/recent-chart','GET',undefined,session))).json(),{recordId:null});
  let history=addChartRecord(emptyHistory(),saved.records[0].chart,'older-single',10);
  history=addChartRecord(history,saved.records[0].chart,'latest-single',20);
  history=addComparisonRecord(history,saved.records[0].chart,saved.records[0].chart,'latest-pair',30);
  history.activeId='older-single';assert.equal((await putHistory(request('/api/history','PUT',history,session))).status,200);
  const read=async()=>{const response=await getRecentChart(request('/api/account/recent-chart','GET',undefined,session));assert.equal(response.status,200);return response.json();};
  assert.deepEqual(await read(),{recordId:'older-single'});
  assert.deepEqual(await (await getRecentChart(request('/api/account/recent-chart?userId='+aliceId,'GET',undefined,session))).json(),{recordId:'older-single'});
  history.activeId='latest-pair';await putHistory(request('/api/history','PUT',history,session));assert.deepEqual(await read(),{recordId:'latest-single'});
  history.activeId=null;await putHistory(request('/api/history','PUT',history,session));assert.deepEqual(await read(),{recordId:'latest-single'});
  const before=await (await getHistory(request('/api/history','GET',undefined,session))).json();await read();assert.deepEqual(await (await getHistory(request('/api/history','GET',undefined,session))).json(),before);
  for(const id of['latest-single','older-single'])await deleteRecord(request('/api/history/'+id,'DELETE',undefined,session),{params:Promise.resolve({id})});
  assert.deepEqual(await read(),{recordId:null});
});

test('server merges professional and plain on both chart kinds and rejects lossy old clients',async()=>{
  const session=cookie(await authPost(request('/api/auth/register','POST',{username:'plain_owner',password:'Plain-Owner-2026'}),context('register')));
  const conversation=(content:string,updatedAt:number)=>({messages:[{role:'assistant' as const,content}],phase:'complete' as const,updatedAt});
  for(const comparison of[false,true]){
    const id=comparison?'pair-plain':'single-plain';const base=comparison?addComparisonRecord(emptyHistory(),saved.records[0].chart,saved.records[0].chart,id,1):addChartRecord(emptyHistory(),saved.records[0].chart,id,1);
    const project=(pro:string,proAt:number,plain:string,plainAt:number)=>comparison?projectComparison(conversation(pro,proAt),{overview:conversation(plain,plainAt)},'plain'):projectInsight({overview:conversation(pro,proAt)},'overview',{plainTopics:{overview:conversation(plain,plainAt)},readingMode:'plain'});
    assert.equal((await putHistory(request('/api/history','PUT',updateRecordInsight(base,id,project('专业新',100,'白话旧',20),200),session))).status,200);
    const result=await (await putHistory(request('/api/history','PUT',updateRecordInsight(base,id,project('专业旧',10,'白话新',110),190),session))).json();
    const record=result.history.records.find((r:{id:string})=>r.id===id);assert.equal(record.insight.messages[0].content,'专业新');assert.equal(record.insight.plainTopics.overview.messages[0].content,'白话新');
    const lossy=structuredClone(record);delete lossy.insight.plainTopics;delete lossy.insight.readingMode;lossy.updatedAt=300;
    assert.equal((await putHistory(request('/api/history','PUT',{...emptyHistory(),records:[lossy]},session))).status,400);
    const after=await (await getHistory(request('/api/history','GET',undefined,session))).json();assert.equal(after.history.records.find((r:{id:string})=>r.id===id).insight.plainTopics.overview.messages[0].content,'白话新');
  }
});
