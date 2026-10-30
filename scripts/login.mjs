import { chromium } from 'playwright';
import { mkdir, chmod } from 'node:fs/promises';
import { profileDirectory } from '../src/profile.mjs';

process.umask(0o077);
if (!process.env.DISPLAY) throw new Error('DISPLAY required: use a local desktop or secured research display.');
const profile = profileDirectory();
await mkdir(profile, { recursive: true, mode: 0o700 });
await chmod(profile, 0o700);
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  ...(process.env.BHX_CHROMIUM_PATH ? { executablePath: process.env.BHX_CHROMIUM_PATH } : {}),
});
// No tracing, HAR, request bodies, cookies, account text or tokens are logged.
const page = context.pages()[0] || await context.newPage();
try {
  await page.goto('https://www.bachhoaxanh.com/dang-nhap', { waitUntil: 'domcontentloaded', timeout: 60000 });
} catch {
  await context.close();
  console.error('LOGIN_NAVIGATION_FAILED: retry interactive login.');
  process.exit(1);
}
console.log(JSON.stringify({ event: 'login_browser_ready', authenticated: 'not_verified' }));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await context.close();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
await new Promise(resolve => context.once('close', resolve));
