# Probe: does the cart page itself call an address-list endpoint when the picker is opened,
# and is the picker the only source of address data (i.e. no guest-visible address endpoint)?
import { chromium } from 'playwright';
import { profileDirectory } from '../src/profile.mjs';

const browser = await chromium.launch({ headless: true, executablePath: process.env.BHX_CHROMIUM_PATH });
const ctx = await browser.newContext({ storageState: undefined });
const page = await ctx.newPage();
const seen = [];
page.on('response', async (r) => {
  const u = r.url();
  if (!/\/gw\//.test(u)) return;
  if (!/address|profile|district|ward|store|location|delivery/i.test(u)) return;
  let body: any = null;
  try { body = await r.json(); } catch { body = await r.text().catch(() => null); }
  seen.push({ url: u, status: r.status(), body: typeof body === 'string' ? body.slice(0, 200) : body });
});

// open cart (park), then click #btn_choose_location to force the picker to load
await page.goto('https://bachhoaxanh.com/gio-hang', { waitUntil: 'domcontentloaded', timeout: 45000 });
// wait for address picker to exist
const btn = page.locator('#btn_choose_location');
if (await btn.count()) {
  await btn.click().catch(() => {});
  await page.waitForTimeout(3000);
}
console.log(JSON.stringify({ seen: seen.map(s => ({ url: s.url, status: s.status, sample: JSON.stringify(s.body).slice(0, 120) })), count: seen.length }, null, 2));
await browser.close();
