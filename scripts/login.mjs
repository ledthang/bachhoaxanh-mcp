// MCP login child: fills phone, triggers OTP SMS, waits for relayed code on stdin, verifies, persists cookie.
// Headless (BHX_CHROMIUM_PATH executable with --headless). No DISPLAY/VNC needed.
import { chromium } from 'playwright';
import { mkdir, chmod } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { profileDirectory } from '../src/profile.mjs';

process.umask(0o077);
const phone = (process.env.BHX_PHONE || '').replace(/\D/g, '');
if (!/^\d{9,10}$/.test(phone)) {
  console.log(JSON.stringify({ event: 'login_failed', error: 'BHX_PHONE_REQUIRED' }));
  process.exit(0);
}
const profile = profileDirectory();
await mkdir(profile, { recursive: true, mode: 0o700 });
await chmod(profile, 0o700);
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  viewport: { width: 1280, height: 900 },
  locale: 'vi-VN',
  ...(process.env.BHX_CHROMIUM_PATH ? { executablePath: process.env.BHX_CHROMIUM_PATH } : {}),
});
let done = false;
async function finish(event, extra = {}) {
  if (done) return;
  done = true;
  console.log(JSON.stringify({ event, ...extra }));
  await context.close();
  process.exit(0);
}
process.on('SIGTERM', () => { void context.close().then(() => process.exit(0)); });

try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.bachhoaxanh.com/dang-nhap', { waitUntil: 'networkidle', timeout: 60000 });
  if (!/dang-nhap/.test(page.url())) { await finish('login_failed', { error: 'UNEXPECTED_ROUTE', code: page.url().slice(0, 120) }); }
  await page.waitForSelector('#phone', { timeout: 20000 });
  await page.fill('#phone', phone);
  const sessions = page.waitForResponse(r => /auth\/aio\/sessions/.test(r.url()), { timeout: 30000 });
  await page.click("button:has-text('TIẾP TỤC')");
  const res = await sessions.catch(() => null);
  if (!res) { await finish('login_failed', { error: 'TRIGGER_NO_RESPONSE' }); }
  let body = null;
  try { body = JSON.parse(await res.text()); } catch { /* fallthrough */ }
  if (!body?.data?.sessionId) { await finish('login_failed', { error: 'TRIGGER_REJECTED', code: body?.messageTitle || `HTTP_${res.status()}` }); }
  const expiresIn = Number(body.data.expiresIn) || 120;
  console.log(JSON.stringify({ event: 'sms_sent', expires_in: expiresIn }));

  const rl = createInterface({ input: process.stdin });
  const line = await Promise.race([
    new Promise(r => rl.once('line', r)),
    new Promise(r => setTimeout(() => r(null), expiresIn * 1000)),
  ]);
  const otp = (line ?? '').trim();
  if (line === null) { await finish('login_failed', { error: 'OTP_WINDOW_EXPIRED' }); }
  if (!/^\d{4,8}$/.test(otp)) { await finish('login_failed', { error: 'OTP_FORMAT' }); }

  await page.fill('#otp-input', otp);
  const verified = page.waitForResponse(r => /auth\/aio\/verify/.test(r.url()), { timeout: 30000 });
  await page.click("button:has-text('TIẾP TỤC')");
  const vres = await verified.catch(() => null);
  if (!vres) { await finish('login_failed', { error: 'VERIFY_NO_RESPONSE' }); }
  let v = null;
  try { v = JSON.parse(await vres.text()); } catch { /* fallthrough */ }
  if (v && (v.code === 200 || v.isSuccess)) await finish('login_ok');
  else await finish('login_failed', { error: 'VERIFY_REJECTED', code: v?.messageTitle || `HTTP_${vres.status()}` });
} catch (e) {
  await finish('login_failed', { error: 'RELAY_CRASH', detail: String(e?.message || e).slice(0, 160) });
}
