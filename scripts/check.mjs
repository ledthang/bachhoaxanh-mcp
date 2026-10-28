import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json'));
const lock = JSON.parse(readFileSync('package-lock.json'));
assert.equal(lock.packages['node_modules/playwright'].version, pkg.dependencies.playwright);
for (const script of ['scripts/login.mjs']) {
  assert.equal(spawnSync(process.execPath, ['--check', script]).status, 0);
}
const env = { ...process.env };
delete env.DISPLAY;
const result = spawnSync(process.execPath, ['scripts/login.mjs'], { env, encoding: 'utf8' });
assert.notEqual(result.status, 0);
assert.match(result.stderr, /DISPLAY required/);
for (const path of ['node_modules/example', '.env', 'cookies.json', 'profiles/session', 'data/test.db', 'capture.har', 'test.log']) {
  assert.equal(spawnSync('git', ['check-ignore', '--quiet', path]).status, 0, path);
}
console.log('PASS: offline POC checks; authenticated integration not tested.');
