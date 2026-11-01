// Diagnostic reproduction of KNOWN_ISSUES P2. No real account or token is printed.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { POST as auth } from '../../app/api/auth/[action]/route';
import { POST as password } from '../../app/api/account/route';
import { database } from '../../lib/server/database';

async function main() {
  mkdirSync('.codex-local', { recursive: true });
  const directory = mkdtempSync(path.resolve('.codex-local/review-device-'));
  process.env.MINGLI_DATA_DIR = directory;
  process.env.APP_ALLOWED_ORIGINS = 'http://127.0.0.1:3100';
  const request = (url: string, body: unknown, cookie = '') => new Request('http://127.0.0.1:3100' + url, {
    method: 'POST', headers: {
      Origin: 'http://127.0.0.1:3100', 'Content-Type': 'application/json', Cookie: cookie,
    }, body: JSON.stringify(body),
  });
  const context = (action: string) => ({ params: Promise.resolve({ action }) });
  const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]);
  const oldPassword = randomBytes(20).toString('hex'), newPassword = randomBytes(20).toString('hex');
  try {
    const registered = await auth(request('/api/auth/register', {
      username: 'review_device_owner', password: oldPassword,
    }), context('register'));
    assert.equal(registered.status, 201);
    const old = cookies(registered), device = old.find(value => value.startsWith('mingli_device='));
    assert.ok(device);
    const changed = await password(request('/api/account', {
      currentPassword: oldPassword, newPassword,
    }, old.join('; ')));
    assert.equal(changed.status, 200);
    const next = cookies(changed).find(value => value.startsWith('mingli_device='));
    const oldTokenLogin = await auth(request('/api/auth/device-login', {}, device), context('device-login'));
    const report = {
      passwordChangeStatus: changed.status, currentDeviceTokenRotated: !!next && next !== device,
      oldDeviceTokenAloneLoginStatus: oldTokenLogin.status, oldCredentialStillAuthenticates: oldTokenLogin.status === 200,
      isolatedDataDirectory: directory, productionDataTouched: false,
    };
    writeFileSync('.codex-local/review-device-token-latest.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { database().close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
