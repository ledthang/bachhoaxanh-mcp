import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Offline, deterministic: no Chromium, no network, no real profile needed.
const { profileDirectory } = await import(
  pathToFileURL(join(process.cwd(), 'src/profile.mjs')).href);
const DEFAULT_PATH = join(homedir(), '.local/share/bhx-mcp/profile');
const work = await mkdtemp(join(tmpdir(), 'bhx-profile-test-'));
const restore = { BHX_PROFILE_DIR: process.env.BHX_PROFILE_DIR, BHX_RUNTIME_DIR: process.env.BHX_RUNTIME_DIR };

// Table 1: precedence (a > b > c), relative-path resolution, unset/empty handling.
const cases = [
  { name: 'c: nothing set -> default path', BHX_PROFILE_DIR: undefined, BHX_RUNTIME_DIR: undefined, expect: DEFAULT_PATH },
  { name: 'c: both empty -> default path', BHX_PROFILE_DIR: '', BHX_RUNTIME_DIR: '   ', expect: DEFAULT_PATH },
  { name: 'b: runtime dir only -> runtime/profile', BHX_RUNTIME_DIR: join(work, 'rt'), expect: join(work, 'rt', 'profile') },
  { name: 'b: nested runtime dir -> runtime/profile', BHX_RUNTIME_DIR: join(work, 'a', 'b', 'c'), expect: join(work, 'a', 'b', 'c', 'profile') },
  { name: 'a: profile dir wins over runtime dir', BHX_PROFILE_DIR: join(work, 'win'), BHX_RUNTIME_DIR: join(work, 'lose'), expect: join(work, 'win') },
  { name: 'a: profile dir wins over empty runtime dir', BHX_PROFILE_DIR: join(work, 'only'), BHX_RUNTIME_DIR: '', expect: join(work, 'only') },
  { name: 'relative runtime dir resolves against homedir', BHX_RUNTIME_DIR: 'bhx-relative-rt', expect: join(homedir(), 'bhx-relative-rt', 'profile') },
  { name: 'relative profile dir resolves against homedir', BHX_PROFILE_DIR: 'bhx-relative-prof', BHX_RUNTIME_DIR: 'bhx-relative-rt', expect: join(homedir(), 'bhx-relative-prof') },
  { name: 'dot-relative runtime dir resolves against homedir', BHX_RUNTIME_DIR: './bhx-dot-rt', expect: join(homedir(), 'bhx-dot-rt', 'profile') },
];
for (const { name, expect, ...env } of cases) {
  // Clear both keys first: a case that omits one must not inherit the previous case's value.
  // process.env coerces undefined to the string "undefined", so skip instead of assigning.
  delete process.env.BHX_PROFILE_DIR;
  delete process.env.BHX_RUNTIME_DIR;
  for (const [key, value] of Object.entries(env)) if (value !== undefined) process.env[key] = value;
  const actual = profileDirectory();
  assert.ok(actual.startsWith('/'), `${name}: absolute`);
  assert.equal(actual, expect, name);
}

// Table 2: existing-but-not-a-directory must raise a clear error.
const filePath = join(work, 'plain-file');
await writeFile(filePath, 'x', { mode: 0o600 });
const nestedRuntime = join(work, 'nested');
await mkdir(join(nestedRuntime, 'profile'), { recursive: true, mode: 0o700 });
const fileInRuntime = join(work, 'runtime-file');
await writeFile(fileInRuntime, 'x', { mode: 0o600 });
const errorCases = [
  { name: 'profile dir path exists as a file', BHX_PROFILE_DIR: filePath, BHX_RUNTIME_DIR: undefined },
  { name: 'runtime/profile path exists as a file', BHX_PROFILE_DIR: undefined, BHX_RUNTIME_DIR: fileInRuntime },
];
for (const { name, BHX_PROFILE_DIR, BHX_RUNTIME_DIR } of errorCases) {
  if (BHX_PROFILE_DIR === undefined) delete process.env.BHX_PROFILE_DIR; else process.env.BHX_PROFILE_DIR = BHX_PROFILE_DIR;
  if (BHX_RUNTIME_DIR === undefined) delete process.env.BHX_RUNTIME_DIR; else process.env.BHX_RUNTIME_DIR = BHX_RUNTIME_DIR;
  let thrown = null;
  try { profileDirectory(); } catch (error) { thrown = error; }
  assert.ok(thrown instanceof Error, name);
  assert.match(thrown.message, /^BHX_PROFILE_NOT_A_DIRECTORY: \//, name);
}

// Restore environment for any later suite in this process.
for (const key of ['BHX_PROFILE_DIR', 'BHX_RUNTIME_DIR']) {
  if (restore[key] === undefined) delete process.env[key]; else process.env[key] = restore[key];
}
assert.equal(profileDirectory(), DEFAULT_PATH, 'environment restored to default');

// Structural guard: every patched module must delegate to profileDirectory().
const patched = ['src/browser.mjs', 'src/cart-mutations.mjs', 'src/delivery.mjs',
  'scripts/catalog-poc.mjs', 'scripts/login.mjs', 'scripts/cart-cycle.mjs',
  'scripts/cart-poc.mjs', 'scripts/cart-trial.mjs'];
for (const path of patched) {
  const source = readFileSync(path, 'utf8');
  assert.match(source, /import \{ profileDirectory \} from '(?:\.\.\/src\/|\.\/)profile\.mjs';/, `${path} imports profileDirectory`);
  assert.match(source, /profileDirectory\(\)/, `${path} calls profileDirectory()`);
  assert.doesNotMatch(source, /\.local\/share\/bhx-mcp\/profile/, `${path} has inline default path literal`);
  assert.doesNotMatch(source, /process\.env\.BHX_PROFILE_DIR/, `${path} reads BHX_PROFILE_DIR inline`);
  assert.doesNotMatch(source, /process\.env\.BHX_RUNTIME_DIR/, `${path} reads BHX_RUNTIME_DIR inline`);
}
// Only src/profile.mjs and this test may carry the default path literal.
const guardSource = readFileSync('src/profile.mjs', 'utf8');
assert.match(guardSource, /\.local\/share\/bhx-mcp\/profile/);

await rm(work, { recursive: true, force: true });
console.log('PASS: profile directory precedence, relative resolution, not-a-directory error, no duplicated resolution.');
