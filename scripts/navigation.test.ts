import assert from 'node:assert/strict';
import test from 'node:test';
import { loginPath, safeReturnPath } from '../lib/navigation';

test('login preserves single, comparison, source, new and reading anchor destinations', () => {
  for (const path of ['/chart?record=single-1', '/heming?record=pair-2', '/sources?ref=v4%3A1990-06-15%3A6%3Amale%3Acareer', '/chart?new=1', '/history', '/account#security']) {
    const url = new URL(path, 'https://mingli.invalid');
    const next = new URLSearchParams(loginPath(url).split('?')[1]).get('next');
    assert.equal(safeReturnPath(next), path);
  }
});
test('return destinations cannot escape the app, use control characters or loop to login', () => {
  for (const path of [null, '', '//evil.test', 'https://evil.test/chart', '/\\evil.test', '/chart\\@evil.test', 'javascript:alert(1)', '/login?next=/history', '/api/auth/logout', '/chart/../login', '/sources%2f..', '/chart?x=%0aLocation:evil', '/chart?x=\n']) {
    assert.equal(safeReturnPath(path), '/chart', String(path));
  }
});
