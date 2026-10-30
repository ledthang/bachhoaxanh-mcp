// Probe: where does the /gio-hang SPA keep its cartId, and does a cookie-only fetch of
// full-profile distinguish logged-in from anonymous? Read-only, no click, no mutation.
import { chromium } from 'playwright';
import { profileDirectory } from '../src/profile.mjs';

const CART = 'https://www.bachhoaxanh.com/gio-hang';
const PROFILE = 'https://api.bachhoaxanh.com/gw/bhx-api-identity/api/v1/profile/full-profile';

const ctx = await chromium.launchPersistentContext(profileDirectory(), {
  headless: true, serviceWorkers: 'block', viewport: { width: 1280, height: 900 },
  executablePath: process.env.BHX_CHROMIUM_PATH || undefined, locale: 'vi-VN',
});
const page = ctx.pages()[0] || await ctx.newPage();
for (const old of ctx.pages()) if (old !== page) await old.close();

const gw = [];
page.on('response', async (res) => {
  if (!res.url().includes('/gw/')) return;
  let code = null; try { const j = await res.json(); code = j?.ResultCode ?? j?.code ?? null; } catch {}
  gw.push({ url: res.url(), status: res.status(), code });
});

await page.goto(CART, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(2500);

const dump = await page.evaluate(async (profileUrl) => {
  const ls = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const v = localStorage.getItem(k) || '';
    ls[k] = v.length > 160 ? v.slice(0, 160) + '…' : v;
  }
  const res = await fetch(profileUrl, { credentials: 'include' });
  let body = ''; try { body = (await res.text()).slice(0, 200); } catch {}
  return { ls, cookieNames: document.cookie.split(';').map(c => c.trim().split('=')[0]).filter(Boolean), profile: { status: res.status, body } };
}, PROFILE);

console.log('=== localStorage ===');
for (const [k, v] of Object.entries(dump.ls)) console.log(`  ${k} = ${v}`);
console.log('=== cookie names ===', JSON.stringify(dump.cookieNames));
console.log('=== full-profile (cookie only) ===', dump.profile.status, dump.profile.body);
console.log('=== gw calls seen ===');
for (const g of gw) console.log(`  ${g.status} code=${g.code} ${g.url.slice(0, 110)}`);

await ctx.close();
