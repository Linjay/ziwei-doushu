import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { BrowserSession } from './helpers/cdp-browser.mjs';

const freePort=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const parent=path.resolve('.codex-local');await mkdir(parent,{recursive:true});const run=await mkdtemp(path.join(parent,'guest-browser-'));
const remote=process.env.GUEST_TEST_BASE_URL,port=remote?null:await freePort(),base=remote||`http://127.0.0.1:${port}`,browserPort=await freePort();
const out=process.env.GUEST_TEST_EVIDENCE_DIR?path.resolve(process.env.GUEST_TEST_EVIDENCE_DIR):run;await mkdir(out,{recursive:true});
const report={surface:base,checks:{},sizes:[],physicalDevice:false,errors:[],run,accountFile:path.join(run,'accounts.json')};
const accounts=[],requests=[],newPassword='Guest-Test-'+randomBytes(12).toString('hex');let server,chrome,browser,page,other,recordId;
async function waitService(url){for(let i=0;i<100;i++){try{if((await fetch(url)).ok)return;}catch{}await delay(200);}throw new Error('Service unavailable');}
async function button(text,p=page){await p.evaluate(`(()=>{const e=Array.from(document.querySelectorAll('button')).find(e=>e.getBoundingClientRect().width>0&&e.innerText.trim()===${JSON.stringify(text)});if(!e)throw new Error('Missing visible button '+${JSON.stringify(text)});e.click()})()`);}
async function api(endpoint,method='GET',body,p=page){return p.evaluate(`(async()=>{const response=await fetch(${JSON.stringify(endpoint)},{method:${JSON.stringify(method)},credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},${body===undefined?'':`body:JSON.stringify(${JSON.stringify(body)}),`}});return {status:response.status,data:await response.json()}})()`);}
async function current(p=page){const value=await api('/api/auth/me','GET',undefined,p);assert.equal(value.status,200);return value.data;}
async function check(name,task){await task();report.checks[name]=true;await writeFile(path.join(out,'guest-browser-verification.json'),JSON.stringify(report,null,2));console.log('PASS '+name);}
async function shot(name){await page.screenshot(path.join(out,name+'.png'));}
async function security(){await page.navigate(base+'/account');await page.wait('document.querySelector(".profile-menu")');await button('账号安全');}
async function logout(forget=false){await security();await button(forget?'退出并忘记此设备':'退出当前账号');await page.wait('location.pathname==="/login"&&document.querySelector(".quick-registration")');}
async function selectAccount(account){await page.evaluate(`Array.from(document.querySelectorAll('.remembered-login')).find(e=>e.innerText.includes(${JSON.stringify(account.username)})).click()`);await page.wait('location.pathname!=="/login"');}
async function login(p,account,password){await p.wait('document.querySelector("[name=username]")');await p.fill('[name=username]',account.username);await p.fill('[name=password]',password);await p.evaluate('document.querySelector(".account-form").requestSubmit()');await p.wait('location.pathname!=="/login"');}
try{
  if(!remote){await cp('.next/static','.next/standalone/.next/static',{recursive:true});server=spawn(process.execPath,['.next/standalone/server.js'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:String(port),HOSTNAME:'127.0.0.1',MINGLI_DATA_DIR:path.join(run,'data'),CODEX_CLI_PATH:path.resolve('scripts/fixtures/codex-fake.mjs'),APP_ALLOWED_ORIGINS:base,AUTH_REQUIRED:'true',KNOWLEDGE_REQUIRED:'false',KNOWLEDGE_DB_PATH:'',NEXT_TELEMETRY_DISABLED:'1'}});let logs='';for(const stream of[server.stdout,server.stderr])stream.on('data',chunk=>{logs=(logs+chunk).slice(-10000);void writeFile(path.join(run,'server.log'),logs);});}
  await waitService(base+'/api/health');
  chrome=spawn(process.env.CHROME_PATH||(process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/google-chrome'),['--headless=new',`--remote-debugging-port=${browserPort}`,`--user-data-dir=${path.join(run,'chrome')}`,'--no-first-run','--no-default-browser-check',...(process.platform==='linux'?['--no-sandbox']:[]),'about:blank'],{windowsHide:true,stdio:'ignore'});
  await waitService(`http://127.0.0.1:${browserPort}/json/version`);const info=await fetch(`http://127.0.0.1:${browserPort}/json/version`).then(r=>r.json());browser=await BrowserSession.connect(info.webSocketDebuggerUrl);page=await BrowserSession.page(browserPort);await page.size(390,844,true);await page.send('Network.enable');page.socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Network.requestWillBeSent'&&/\/api\/(interpret|heming|auth\/quick-register|auth\/device-login)$/.test(message.params.request.url))requests.push(new URL(message.params.request.url).pathname);});
  await check('login-first-screen-offers-one-tap-without-creating-an-account',async()=>{
    await page.navigate(base+'/login?next='+encodeURIComponent('/chart?new=1'));await page.wait('document.querySelector(".quick-registration")');assert.equal((await current()).user,null);assert.equal(requests.filter(url=>url.endsWith('quick-register')).length,0);
    assert.ok(await page.evaluate('document.querySelector(".quick-registration .btn-primary").getBoundingClientRect().bottom<innerHeight'));
    for(const width of[320,390,430,768]){await page.size(width,844,width<768);const size=await page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');assert.ok(size.scroll<=size.width+1);report.sizes.push(size);}await page.size(390,844,true);await shot('01-quick-register');
  });
  await check('quick-account-creates-and-saves-a-real-chart-with-initial-password',async()=>{
    await button('快速注册并体验');await page.wait('location.pathname==="/chart"&&document.querySelector("[name=birthday]")');const user=(await current()).user;assert.match(user.username,/^guest_[a-z]+_[a-z]{7}$/);assert.equal(user.usesInitialPassword,true);accounts.push({id:user.id,username:user.username});await writeFile(report.accountFile,JSON.stringify(accounts));
    await page.fill('[name=birthday]','1990-11-03');await page.fill('[name=birthTime]','00:50');await page.fill('[name=birthName]','快速体验验收');await button('下一步');await button('生成命盘');await page.wait('document.querySelector(".chart-reading")');await button('AI 解读');
    await page.wait('!Array.from(document.querySelectorAll("button")).some(e=>e.innerText.trim()==="停止")&&document.querySelector(".reading-text")?.innerText.length>10',180000);await page.wait('document.body.innerText.includes("已同步到账户")');
    recordId=new URL(await page.evaluate('location.href')).searchParams.get('record');const saved=(await api('/api/history')).data.history.records.find(record=>record.id===recordId);assert.equal(saved.chart.birthInfo.hour,1);assert.equal(saved.insight.phase,'complete');await shot('02-guest-chart');
  });
  await check('missing-session-cookie-restores-last-device-account-and-record-without-password',async()=>{
    const ai=requests.filter(url=>url==='/api/interpret').length;await page.send('Network.deleteCookies',{name:'mingli_session',url:base});await page.navigate(base+'/chart?record='+recordId);await page.wait('document.querySelector(".chart-reading")');
    assert.equal((await current()).user.id,accounts[0].id);assert.equal((await api('/api/history')).data.history.records.length,1);assert.equal(requests.filter(url=>url==='/api/interpret').length,ai);assert.ok(requests.some(url=>url==='/api/auth/device-login'));
  });
  await check('logout-pauses-auto-login-and-device-picker-switches-two-private-accounts',async()=>{
    await logout();await page.send('Page.reload');await page.wait('document.querySelector(".remembered-login")');assert.equal((await current()).user,null);await shot('03-remembered-account');
    await button('快速注册并体验');await page.wait('location.pathname!=="/login"');const user=(await current()).user;accounts.push({id:user.id,username:user.username});await writeFile(report.accountFile,JSON.stringify(accounts));assert.notEqual(user.id,accounts[0].id);assert.equal((await api('/api/history')).data.history.records.length,0);
    await logout();assert.equal((await current()).device.accounts.length,2);await selectAccount(accounts[0]);assert.equal((await current()).user.id,accounts[0].id);assert.equal((await api('/api/history')).data.history.records[0].id,recordId);
  });
  await check('changing-initial-password-revokes-other-browser-session-and-remembered-access',async()=>{
    other=await BrowserSession.page(browserPort);await other.size(390,844,true);await other.navigate(base+'/login');await login(other,accounts[0],'12345678');await security();await page.fill('[name=currentPassword]','12345678');await page.fill('[name=newPassword]',newPassword);await page.fill('[name=confirmPassword]',newPassword);await button('更新密码');await page.wait('document.querySelector(".form-success")');assert.equal((await current()).user.usesInitialPassword,false);
    await other.navigate(base+'/history');await other.wait('location.pathname==="/login"&&document.querySelector(".quick-registration")');assert.equal((await current(other)).user,null);assert.equal((await current(other)).device.accounts.length,0);
    assert.equal((await api('/api/auth/login','POST',{username:accounts[0].username,password:'12345678'},other)).status,401);await shot('04-password-updated');
  });
  await check('removing-one-remembered-account-keeps-the-other-account-available',async()=>{
    await logout();await page.evaluate(`document.querySelector(${JSON.stringify(`[aria-label="移除此设备上的 ${accounts[1].username}"]`)}).click()`);await page.wait('document.querySelectorAll(".remembered-login").length===1');assert.equal((await current()).device.accounts[0].id,accounts[0].id);assert.equal((await api('/api/auth/device-login','POST',{userId:accounts[1].id})).status,401);await selectAccount(accounts[0]);
  });
  await check('forgetting-device-removes-all-shortcuts-and-manual-login-retains-history',async()=>{
    await logout(true);assert.equal((await current()).device.accounts.length,0);assert.equal(await page.evaluate('document.querySelectorAll(".remembered-login").length'),0);assert.equal((await api('/api/auth/device-login','POST',{})).status,401);await login(page,accounts[0],newPassword);assert.equal((await api('/api/history')).data.history.records[0].id,recordId);
  });
  report.errors=[...page.errors,...other.errors];assert.equal(report.errors.length,0);report.accountsCreated=accounts.length;report.aiRequests=requests.filter(url=>url==='/api/interpret').length;assert.equal(report.aiRequests,1);report.passed=true;
}catch(error){report.failure=error.stack;report.passed=false;if(page)try{await shot('failure');}catch{}console.error(error.stack);process.exitCode=1;}
finally{await writeFile(path.join(out,'guest-browser-verification.json'),JSON.stringify(report,null,2));await writeFile(path.join(parent,'guest-browser-latest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:Object.keys(report.checks).length,accountsCreated:accounts.length,run}));page?.close();other?.close();if(browser){try{await browser.send('Browser.close');}catch{}browser.close();}else chrome?.kill();server?.kill();}
