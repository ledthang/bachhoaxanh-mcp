// Probe: open the delivery picker on /gio-hang and capture which endpoints serve the saved
// address list + the current location, plus a GET full-profile with the deviceid header.
// Only click is opening/reading the picker; no address is selected, no cart is mutated.
import { chromium } from 'playwright';
import { profileDirectory } from '../src/profile.mjs';

const ctx = await chromium.launchPersistentContext(profileDirectory(), {
  headless: true, serviceWorkers: 'block', viewport: { width: 1280, height: 900 },
  executablePath: process.env.BHX_CHROMIUM_PATH || undefined, locale: 'vi-VN',
});
const page = ctx.pages()[0] || await ctx.newPage();
for (const old of ctx.pages()) if (old !== page) await old.close();

const calls = [];
page.on('response', async (res) => {
  if (!res.url().includes('/gw/')) return;
  let j = null; try { j = await res.json(); } catch {}
  const v = j?.Value ?? j?.data ?? null;
  let shape;
  if (Array.isArray(v)) shape = `array(${v.length}) ${JSON.stringify(v[0] ?? null).slice(0, 140)}`;
  else if (v && typeof v === 'object') shape = JSON.stringify(v).slice(0, 200);
  else shape = String(v).slice(0, 80);
  calls.push({ stage: 'boot', url: res.url(), status: res.status, code: j?.ResultCode ?? j?.code ?? null, shape });
});

await page.goto('https://www.bachhoaxanh.com/gio-hang', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForSelector('#btn_choose_location', { timeout: 30000 });
calls.length = 0;

await page.click('#btn_choose_location');
await page.waitForTimeout(6000);

console.log('=== after opening picker ===');
for (const c of calls) console.log(JSON.stringify(c));

const dialogText = await page.evaluate(() => {
  const dlg = document.querySelector('.lstProfile') || document.body;
  return dlg.innerText.replace(/\s+/g, ' ').slice(0, 500);
});
console.log('=== picker text ===', dialogText);

const profileGet = await page.evaluate(async () => {
  const m = document.cookie.match(/(?:^|;\s*)ck_bhx_us_deviceId=([^;]*)/);
  const dev = m ? m[1] : '';
  const urls = {
    get_no_header: 'https://api.bachhoaxanh.com/gw/bhx-api-identity/api/v1/profile/full-profile',
  };
  const out = { deviceId: dev.slice(0, 12) + '…' };
  const r = await fetch(urls.get_no_header, { method: 'GET', credentials: 'include' });
  out.get_no_header = { status: r.status, body: (await r.text()).slice(0, 200) };
  const r2 = await fetch(urls.get_no_header, { method: 'GET', credentials: 'include', headers: { deviceid: dev } });
  const t2 = await r2.text();
  out.get_with_header = { status: r2.status, body: t2.slice(0, 400) };
  return out;
});
console.log('=== full-profile ===');
console.log(JSON.stringify(profileGet, null, 1));

await ctx.close();
