// Probe: open the location picker on the parked cart page, capture every /gw request the
// picker makes (the address list source + the select POST), so select_address can be wired
// to the real contract instead of an invented endpoint. Read-only except one picker open
// + one radio select + re-read. Cart state untouched.
import { chromium } from 'playwright';
import { profileDirectory } from '../src/profile.mjs';

const ctx = await chromium.launchPersistentContext(profileDirectory(), {
  headless: true, serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, locale: 'vi-VN',
  executablePath: process.env.BHX_CHROMIUM_PATH || undefined,
});
const page = ctx.pages()[0] || await ctx.newPage();
for (const old of ctx.pages()) if (old !== page) await old.close();

const reqs = [];
page.on('request', (r) => { if (r.url().includes('/gw/') && r.method() === 'POST') reqs.push({ url: r.url().replace('https://api.bachhoaxanh.com', ''), body: (r.postData() || '').slice(0, 200) }); });

await page.goto('https://www.bachhoaxanh.com/gio-hang', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(1500);

// open the location picker
const btn = page.locator('#btn_choose_location, .choose-location, [class*="choose"]');
const n = await btn.count();
console.log('picker buttons found:', n);
if (n > 0) {
  await btn.first().click().catch(() => {});
  await page.waitForTimeout(2500);
  const radios = await page.locator('input[type=radio][name=addressReceipt]').count();
  console.log('address radios after open:', radios);
  const rows = await page.locator('.lstProfile > div').allTextContents().catch(() => []);
  console.log('picker rows:', JSON.stringify(rows).slice(0, 600));
}
console.log('GW requests:', JSON.stringify(reqs, null, 1).slice(0, 2000));
await ctx.close();
