import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { POST, GET } from '../app/api/auth/[action]/route';
import { POST as passwordPost } from '../app/api/account/route';
import { GET as getHistory, PUT as putHistory } from '../app/api/history/route';
import { database } from '../lib/server/database';
import { createSession, currentUser, passwordMatches, registerUser } from '../lib/server/auth';
import { addChartRecord, emptyHistory } from '../lib/chart-history';
import { generateChart } from '../lib/ziwei/algorithm';

const root=path.resolve('.codex-local');mkdirSync(root,{recursive:true});const directory=mkdtempSync(path.join(root,'device-auth-test-'));
process.env.MINGLI_DATA_DIR=directory;process.env.APP_ALLOWED_ORIGINS='https://mingli.linjay.fun:16666';
const origin='https://mingli.linjay.fun:16666';
const req=(action:string,body:unknown={},cookie='',source=origin)=>new Request(source+'/api/auth/'+action,{method:'POST',headers:{Origin:source,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
const post=(action:string,body:unknown={},cookie='')=>POST(req(action,body,cookie),{params:Promise.resolve({action})});
const cookies=(response:Response)=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
const device=(cookie:string)=>cookie.split('; ').find(value=>value.startsWith('mingli_device='))!;
async function me(cookie:string){return (await GET(new Request(origin+'/api/auth/me',{headers:{Origin:origin,Cookie:cookie}}),{params:Promise.resolve({action:'me'})})).json();}
after(()=>{database().close();if(path.dirname(directory)!==root||!path.basename(directory).startsWith('device-auth-test-'))throw new Error('Unsafe cleanup');rmSync(directory,{recursive:true,force:true});});

test('quick registration allocates unique English guest names and only the configured initial password',async()=>{
  const response=await post('quick-register',{username:'forged',password:'arbitrary'});assert.equal(response.status,201);const{user}=await response.json();
  assert.match(user.username,/^guest_[a-z]+_[a-z]{7}$/);assert.equal(user.isGuest,true);assert.equal(user.usesInitialPassword,true);
  const row=database().prepare('SELECT password_hash FROM users WHERE id=?').get(user.id)!;
  assert.match(String(row.password_hash),/^scrypt\$/);assert.equal(await passwordMatches('12345678',String(row.password_hash)),true);
  assert.equal(await passwordMatches('arbitrary',String(row.password_hash)),false);
  const another=await(await post('quick-register')).json();assert.notEqual(user.username,another.user.username);
  assert.equal((await post('register',{username:'ordinary',password:'12345678'})).status,400);
  assert.equal((await post('login',{username:user.username,password:'12345678'})).status,200);
});
test('session and device cookies are independent HttpOnly secrets stored only as hashes',async()=>{
  const response=await post('quick-register');const jar=cookies(response);assert.equal(response.headers.getSetCookie().length,2);
  for(const cookie of response.headers.getSetCookie())assert.match(cookie,/HttpOnly; SameSite=Lax;.*Secure/);
  const raw=device(jar).split('=')[1];assert.match(raw,/^[a-f0-9]{64}$/);
  assert.equal(database().prepare('SELECT 1 FROM remembered_devices WHERE token_hash=?').get(raw),undefined);
  assert.ok(database().prepare('SELECT 1 FROM remembered_devices WHERE token_hash=?').get(createHash('sha256').update(raw).digest('hex')));
  const data=await me(jar);assert.ok(data.user);assert.equal(data.device.accounts.length,1);assert.equal(data.device.autoResume,true);
});
test('remembered device restores an expired session and exactly the same private history',async()=>{
  const signup=await post('quick-register'),jar=cookies(signup),{user}=await signup.json();
  const history=addChartRecord(emptyHistory(),generateChart({year:1990,month:6,day:15,hour:1,gender:'male'}),'device-private');
  assert.equal((await putHistory(new Request(origin+'/api/history',{method:'PUT',headers:{Origin:origin,Cookie:jar,'Content-Type':'application/json'},body:JSON.stringify(history)}))).status,200);
  database().prepare('UPDATE sessions SET expires_at=0 WHERE user_id=?').run(user.id);
  const before=await me(jar);assert.equal(before.user,null);assert.equal(before.device.autoResume,true);
  const resumed=await post('device-login',{},device(jar));assert.equal(resumed.status,200);assert.equal((await resumed.json()).user.id,user.id);
  const restored=await getHistory(new Request(origin+'/api/history',{headers:{Origin:origin,Cookie:cookies(resumed)}}));assert.equal((await restored.json()).history.records[0].id,'device-private');
});
test('device-bound account selection rejects other devices and forged account ids',async()=>{
  const a=await post('quick-register'),aJar=cookies(a),aUser=(await a.json()).user;
  const b=await post('quick-register'),bJar=cookies(b),bUser=(await b.json()).user;
  assert.equal((await post('device-login',{userId:aUser.id},device(bJar))).status,401);
  assert.equal((await post('device-login',{userId:aUser.id})).status,401);
  assert.equal((await post('device-login',{userId:bUser.id},device(aJar))).status,401);
  assert.equal((await post('device-login',{userId:'invalid'},device(aJar))).status,400);
});
test('one browser remembers multiple accounts; explicit logout pauses automatic login but retains choices',async()=>{
  const a=await post('quick-register'),aJar=cookies(a),aUser=(await a.json()).user;
  const b=await post('quick-register',{},device(aJar)),bJar=cookies(b),bUser=(await b.json()).user;
  assert.equal(device(aJar),device(bJar));assert.equal((await me(bJar)).device.accounts.length,2);
  const logout=await post('logout',{},bJar);assert.equal(logout.status,200);
  const state=await me(device(bJar));assert.equal(state.device.autoResume,false);assert.equal(state.device.accounts.length,2);
  assert.equal((await post('device-login',{},device(bJar))).status,401);
  assert.equal(currentUser(req('me',{},aJar)),null);assert.equal(currentUser(req('me',{},bJar)),null);
  const selected=await post('device-login',{userId:aUser.id},device(bJar));assert.equal((await selected.json()).user.id,aUser.id);assert.notEqual(aUser.id,bUser.id);
});
test('forgetting one account revokes its device sessions without deleting history or another account',async()=>{
  const a=await post('quick-register'),jar=cookies(a),user=(await a.json()).user;
  const other=await post('quick-register',{},device(jar));const otherJar=cookies(other);const otherUser=(await other.json()).user;
  assert.equal((await post('forget-device-account',{userId:user.id},otherJar)).status,200);
  assert.equal((await post('device-login',{userId:user.id},device(jar))).status,401);
  assert.ok(database().prepare('SELECT 1 FROM users WHERE id=?').get(user.id));
  assert.equal((await post('device-login',{userId:otherUser.id},device(otherJar))).status,200);
});
test('forgetting this browser clears device credentials and prevents reuse of a copied old token',async()=>{
  const signup=await post('quick-register'),jar=cookies(signup),user=(await signup.json()).user;
  const response=await post('logout',{forgetDevice:true},jar);assert.equal(response.status,200);assert.ok(response.headers.getSetCookie().some(value=>value.startsWith('mingli_device=;')&&value.includes('Max-Age=0')));
  assert.equal((await me(jar)).device.accounts.length,0);assert.equal((await post('device-login',{userId:user.id},device(jar))).status,401);
  assert.equal((await post('login',{username:user.username,password:'12345678'})).status,200);
});
test('password changes revoke other devices and the initial password, then keep this device enrolled',async()=>{
  const signup=await post('quick-register'),jar=cookies(signup),user=(await signup.json()).user;
  const other=await post('login',{username:user.username,password:'12345678'}),otherJar=cookies(other);
  const changed=await passwordPost(new Request(origin+'/api/account',{method:'POST',headers:{Origin:origin,Cookie:jar,'Content-Type':'application/json'},body:JSON.stringify({currentPassword:'12345678',newPassword:'Changed-Password-2026'})}));assert.equal(changed.status,200);
  assert.equal((await changed.json()).user.usesInitialPassword,false);assert.equal((await me(cookies(changed))).user.id,user.id);
  assert.equal((await post('device-login',{},device(otherJar))).status,401);assert.equal((await me(otherJar)).user,null);
  assert.equal((await post('login',{username:user.username,password:'12345678'})).status,401);
  assert.equal((await post('login',{username:user.username,password:'Changed-Password-2026'})).status,200);
});
test('expired or fabricated device tokens cannot list or restore accounts',async()=>{
  const signup=await post('quick-register'),jar=cookies(signup);database().prepare('UPDATE remembered_devices SET expires_at=0 WHERE token_hash=?').run(createHash('sha256').update(device(jar).split('=')[1]).digest('hex'));
  assert.equal((await me(device(jar))).device.accounts.length,0);assert.equal((await post('device-login',{},device(jar))).status,401);
  assert.equal((await post('device-login',{},'mingli_device='+ 'a'.repeat(64))).status,401);
});
test('existing logged-in accounts enroll this browser without re-entering a password or changing their password',async()=>{
  const user=await registerUser({username:'existing_regular',password:'Original-Password-2026'});
  const legacy=createSession(user.id,req('remember-device')).split(';')[0];
  const enrolled=await post('remember-device',{},legacy);assert.equal(enrolled.status,200);
  assert.equal(currentUser(req('me',{},legacy)),null);assert.equal((await me(cookies(enrolled))).user.id,user.id);
  assert.equal((await post('device-login',{},device(cookies(enrolled)))).status,200);
  const quick=await post('quick-register',{},cookies(enrolled));assert.equal(quick.status,200);assert.equal((await quick.json()).user.id,user.id);
  assert.equal((await post('login',{username:user.username,password:'12345678'})).status,401);
  assert.equal((await post('remember-device')).status,401);
});
test('quick registration and device endpoints retain origin checks and shared signup rate limits',async()=>{
  assert.equal((await POST(req('quick-register',{},'','https://other.example'),{params:Promise.resolve({action:'quick-register'})})).status,403);
  for(let i=0;i<25;i++)await post('register',{username:'invalid name',password:'short'});
  assert.equal((await post('quick-register')).status,429);
});
