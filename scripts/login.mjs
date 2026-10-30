// Relay login child (detached, headless): fills phone, triggers OTP SMS,
// polls otp.code (written by MCP server when user replies in chat), verify, persist cookie.
// Events land on stdout/stderr -> relay.log (detached has no stdin; file transport is the point).
import { chromium } from 'playwright';
import { mkdir, chmod, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { profileDirectory } from '../src/profile.mjs';

process.umask(0o077);
const dir = profileDirectory();
const OTP_FILE = join(dir, 'otp.code');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const emit = (event, extra = {}) => console.log(JSON.stringify({ event, ...extra }));

let done = false;
async function finish(event, extra = {}) {
  if (done) return;
  done = true;
  emit(event, extra);
  await rm(OTP_FILE, { force: true }).catch(() => {});
  await context.close();
  process.exit(0);
}
process.on('SIGTERM', () => { void context.close().then(() => process.exit(0)); });

await mkdir(dir, { recursive: true, mode: 0o700 });
await chmod(dir, 0o700);
const context = await chromium.launchPersistentContext(dir, {
  headless: true,
  viewport: { width: 1280, height: 900 },
  locale: 'vi-VN',
  ...(process.env.BHX_CHROMIUM_PATH ? { executablePath: process.env.BHX_CHROMIUM_PATH } : {}),
});

try {
  const phone = (process.env.BHX_PHONE || '').replace(/\D/g, '');
  if (!/^\d{9,10}$/.test(phone)) { await finish('login_failed', { error: 'BHX_PHONE_REQUIRED' }); }
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.bachhoaxanh.com/dang-nhap', { waitUntil: 'networkidle', timeout: 60000 });
  if (!/dang-nhap/.test(page.url())) { await finish('login_failed', { error: 'UNEXPECTED_ROUTE', detail: page.url().slice(0, 120) }); }
  await page.waitForSelector('#phone', { timeout: 20000 });
  await page.fill('#phone', phone);
  const sessions = page.waitForResponse(r => /auth\/aio\/sessions/.test(r.url()), { timeout: 30000 });
  await page.click("button:has-text('TIẾP TỤC')");
  const res = await sessions.catch(() => null);
  if (!res) { await finish('login_failed', { error: 'TRIGGER_NO_RESPONSE' }); }
  let body = null;
  try { body = JSON.parse(await res.text()); } catch { /* fallthrough */ }
  if (!body?.data?.sessionId) { await finish('login_failed', { error: 'TRIGGER_REJECTED', detail: body?.messageTitle || `HTTP_${res.status()}` }); }
  const expiresIn = Number(body.data.expiresIn) || 120;
  emit('sms_sent', { expires_in: expiresIn });

  let otp = null;
  for (let waited = 0; waited < expiresIn * 1000; waited += 1000) {
    await sleep(1000);
    try { const c = (await readFile(OTP_FILE, 'utf8')).trim(); if (/^\d{4,8}$/.test(c)) { otp = c; break; } } catch { /* not yet */ }
    if (await page.evaluate(() => /\/(account|gio-hang|trang-chu)/.test(location.pathname))) {
      const u = page.url();
      if (/\/(gio-hang|trang-chu|account)/.test(u)) { await finish('login_failed', { error: 'WINDOW_CLOSED_EARLY', detail: u.slice(0, 120) }); }
    }
  }
  if (otp === null) { await finish('login_failed', { error: 'OTP_WINDOW_EXPIRED' }); }
  await rm(OTP_FILE, { force: true }).catch(() => {});

  await page.fill('#otp-input', otp);
  const verified = page.waitForResponse(r => /auth\/aio\/verify/.test(r.url()), { timeout: 30000 });
  await page.click("button:has-text('TIẾP TỤC')");
  const vres = await verified.catch(() => null);
  if (!vres) { await finish('login_failed', { error: 'VERIFY_NO_RESPONSE' }); }
  let v = null;
  try { v = JSON.parse(await vres.text()); } catch { /* fallthrough */ }
  if (v && (v.code === 200 || v.isSuccess)) await finish('login_ok');
  else await finish('login_failed', { error: 'VERIFY_REJECTED', detail: v?.messageTitle || `HTTP_${vres.status()}` });
} catch (e) {
  await finish('login_failed', { error: 'RELAY_CRASH', detail: String(e?.message || e).slice(0, 160) });
}
