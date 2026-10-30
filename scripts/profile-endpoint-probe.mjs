// Find the real full-profile endpoint (host/path) the site calls, and what it returns now
// (guest). Captures any response whose url contains 'full-profile' or 'profile'. Read-only.
import { chromium } from 'playwright';
import { profileDirectory } from '../src/profile.mjs';
const ctx = await chromium.launchPersistentContext(profileDirectory(), {
  headless: true, serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, locale: 'vi-VN',
  executablePath: process.env.BHX_CHROMIUM_PATH || undefined,
});
const page = ctx.pages()[0] || await ctx.newPage();
for (const old of ctx.pages()) if (old !== page) await old.close();
const hits = [];
page.on('response', async (r) => {
  const u = r.url();
  if (/profile|thong-tin|account|tai-khoan/i.test(u)) {
    let body = null; try { body = await r.text(); } catch {}
    hits.push({ url: u.slice(0, 160), status: r.status(), body: (body || '').slice(0, 400) });
  }
});
await page.goto('https://www.bachhoaxanh.com/thong-tin-cua-toi', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(2000);
console.log(JSON.stringify(hits, null, 1));
await ctx.close();
