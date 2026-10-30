// Probe the live /gio-hang SPA: capture every /gw/ request+response pair (method, body, code)
// so the manual fetch contract in src/session.mjs can be matched to what the site actually sends.
// Read-only: no click, no mutation.
import { chromium } from 'playwright';
import { profileDirectory } from '../src/profile.mjs';

const CART = 'https://www.bachhoaxanh.com/gio-hang';
const ctx = await chromium.launchPersistentContext(profileDirectory(), {
  headless: true, serviceWorkers: 'block', viewport: { width: 1280, height: 900 },
  executablePath: process.env.BHX_CHROMIUM_PATH || undefined, locale: 'vi-VN',
});
const page = ctx.pages()[0] || await ctx.newPage();
for (const old of ctx.pages()) if (old !== page) await old.close();

const pairs = [];
page.on('response', async (res) => {
  if (!res.url().includes('/gw/')) return;
  let body = null;
  try { body = await res.json(); } catch { body = { _nonjson: true }; }
  let post = null;
  try { post = res.request().postData(); } catch { /* none */ }
  pairs.push({
    url: res.url(), method: res.request().method(),
    status: res.status(),
    post: post ? post.slice(0, 400) : null,
    code: body?.ResultCode ?? body?.code ?? body?.HttpCode ?? null,
    snippet: JSON.stringify(body).slice(0, 260),
  });
});

await page.goto(CART, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(3000);

const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 600);
console.log('=== PAGE URL ===', page.url());
console.log('=== LOGIN SIGNAL ===', {
  has_login_link: await page.locator("a[href*='dang-nhap']").count(),
  has_gio_hang_heading: /gi[oỏ] h[aà]ng/i.test(text),
  text_head: text,
});
console.log('=== GW CALLS (%d) ===', pairs.length);
for (const p of pairs) console.log(JSON.stringify(p));

await ctx.close();
