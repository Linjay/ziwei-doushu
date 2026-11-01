// Diagnostic reproduction of KNOWN_ISSUES P1. Uses only synthetic local data and a fake CLI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { BrowserSession } from '../helpers/cdp-browser.mjs';
import { generateChart } from '../../lib/ziwei/algorithm.ts';
import { addChartRecord, emptyHistory } from '../../lib/chart-history.ts';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
await mkdir('.codex-local', { recursive: true });
const run = await mkdtemp(path.resolve('.codex-local/review-tabs-'));
const appPort = await freePort(), browserPort = await freePort();
const base = `http://127.0.0.1:${appPort}`;
const report = { run, productionDataTouched: false, realModelCalled: false };
let server, chrome, browser, a, b;

async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await delay(100);
  }
  throw new Error('Service unavailable: ' + url);
}
async function api(page, url, method = 'GET', body) {
  return page.evaluate(`(async()=>{
    const r=await fetch(${JSON.stringify(url)}, {
      method:${JSON.stringify(method)}, headers:{'Content-Type':'application/json'},
      ${body === undefined ? '' : `body:JSON.stringify(${JSON.stringify(body)}),`}
    });
    const data=await r.json(); if(!r.ok)throw new Error(r.status+JSON.stringify(data)); return data;
  })()`);
}

try {
  // npm run build must have generated the standalone server first.
  await cp('.next/static', '.next/standalone/.next/static', { recursive: true });
  server = spawn(process.execPath, ['.next/standalone/server.js'], {
    windowsHide: true, stdio: 'ignore', env: {
      ...process.env, PORT: String(appPort), HOSTNAME: '127.0.0.1',
      MINGLI_DATA_DIR: path.join(run, 'data'), APP_ALLOWED_ORIGINS: base, AUTH_REQUIRED: 'true',
      CODEX_CLI_PATH: path.resolve('scripts/fixtures/codex-fake.mjs'),
      KNOWLEDGE_REQUIRED: 'false', KNOWLEDGE_DB_PATH: '', NEXT_TELEMETRY_DISABLED: '1',
    },
  });
  await ready(base + '/api/health');
  const chromePath = process.env.CHROME_PATH || (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
  chrome = spawn(chromePath, [
    '--headless=new', `--remote-debugging-port=${browserPort}`, `--user-data-dir=${path.join(run, 'chrome')}`,
    '--no-first-run', '--no-default-browser-check',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  let chromeError;
  chrome.on('error', error => { chromeError = error; });
  try { await ready(`http://127.0.0.1:${browserPort}/json/version`); }
  catch (error) { throw chromeError || error; }
  const info = await fetch(`http://127.0.0.1:${browserPort}/json/version`).then(r => r.json());
  browser = await BrowserSession.connect(info.webSocketDebuggerUrl);
  a = await BrowserSession.page(browserPort);
  await a.size(390, 844, true);
  await a.navigate(base + '/login');
  await a.wait('document.querySelector("[name=username]")');
  const password = randomBytes(20).toString('hex'), suffix = Date.now();
  const alice = await api(a, '/api/auth/register', 'POST', {
    username: 'reviewa_' + suffix, password, displayName: 'Review Account A',
  });
  const { targetInfo } = await a.send('Target.getTargetInfo');
  // Share the cookie jar: a second isolated browser would miss the bug.
  b = await BrowserSession.page(browserPort, targetInfo.browserContextId);
  await b.navigate(base + '/');
  const bob = await api(b, '/api/auth/register', 'POST', {
    username: 'reviewb_' + suffix, password, displayName: 'Review Account B',
  });
  await api(b, '/api/auth/device-login', 'POST', { userId: alice.user.id });
  const history = addChartRecord(emptyHistory(), generateChart({
    year: 1990, month: 6, day: 15, hour: 6, gender: 'male', name: 'Private-to-account-A',
  }), 'cross-tab-sensitive-A');
  await api(a, '/api/history', 'PUT', history);
  await a.navigate(base + '/chart?record=cross-tab-sensitive-A&view=insight');
  await a.wait('document.querySelector(".insight-composer textarea")');
  await a.wait('document.body.innerText.includes("已同步到账户")');
  await api(b, '/api/auth/logout', 'POST', {});
  await api(b, '/api/auth/device-login', 'POST', { userId: bob.user.id });
  assert.equal((await api(b, '/api/history')).history.records.length, 0);
  assert.equal((await api(a, '/api/auth/me')).user.id, bob.user.id);
  report.oldTabStillShowsA = await a.evaluate('document.querySelector(".session-name").innerText==="Review Account A"');
  await a.fill('.insight-composer textarea', 'This is an account A private follow-up.');
  await a.evaluate('document.querySelector("[aria-label=发送追问]").click()');
  await a.wait('!document.querySelector(".insight-composer textarea").disabled');
  await a.wait('document.body.innerText.includes("已同步到账户")');
  const bHistory = (await api(b, '/api/history')).history;
  report.sessionIsNowB = true;
  report.bReceivesAPrivateRecord = bHistory.records.some(record => record.id === 'cross-tab-sensitive-A');
  report.bRecordCount = bHistory.records.length;
  report.reproduced = report.oldTabStillShowsA && report.bReceivesAPrivateRecord;
  await a.screenshot(path.join(run, 'stale-account-view.png'));
  console.log(JSON.stringify(report));
} catch (error) {
  report.failure = error.stack;
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await writeFile(path.join(run, 'verification.json'), JSON.stringify(report, null, 2));
  await writeFile('.codex-local/review-cross-tab-latest.json', JSON.stringify(report, null, 2));
  a?.close(); b?.close();
  if (browser) {
    try { await browser.send('Browser.close'); } catch {}
    browser.close();
  } else chrome?.kill();
  server?.kill();
}
