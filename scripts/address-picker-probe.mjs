// Probe the 2-entry saved-address picker: DOM structure + real SelectProfile contract.
// Read-only until the click; captures POST body/response so cross-address selection can be coded exactly.
import { chromium } from 'playwright';
import { profileDirectory } from '../src/profile.mjs';
import { writeFileSync } from 'node:fs';

const api = 'https://api.bachhoaxanh.com';
const prefix = api + '/gw/cart/api/OrderV2/';
const TARGET = process.argv[2];
if (!TARGET) throw new Error('usage: address-picker-probe.mjs <addressId> [confirm]');
const CONFIRM = process.argv[3] === 'confirm';

const browser = await chromium.launchPersistentContext(profileDirectory(), {
  headless: true, serviceWorkers: 'block',
  executablePath: process.env.BHX_CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
for (const old of browser.pages()) if (old !== page) await old.close();

const cap = { fullProfile: null, cartGet: null, selectPosts: [], selectResponses: [] };
page.on('response', async (r) => {
  try {
    if (r.url().endsWith('/profile/full-profile')) cap.fullProfile = await r.json();
    if (r.url() === prefix + 'get') {
      const b = await r.json();
      cap.cartGet = { post: r.request().postDataJSON(), value: b?.Value };
    }
    if (r.url() === prefix + 'SelectProfile') {
      cap.selectPosts.push(r.request().postDataJSON());
      cap.selectResponses.push({ ok: r.ok(), status: r.status(), body: await r.json().catch(() => null) });
    }
  } catch (e) { cap._err = String(e).slice(0, 200); }
});

await page.goto('https://www.bachhoaxanh.com/gio-hang', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#btn_choose_location', { timeout: 60000 });
for (let i = 0; i < 80; i++) {
  if (cap.fullProfile && cap.cartGet) break;
  await page.waitForTimeout(500);
}

const rec = cap.fullProfile?.data?.addressReceiver ?? [];
console.log('=== addressReceiver entries ===');
for (const a of rec) console.log(JSON.stringify(a, null, 0).slice(0, 900));
console.log('cart: id=%s TotalItemShow=%s', cap.cartGet?.value?.CartId, cap.cartGet?.value?.TotalItemShow);
console.log('cart GET post:', JSON.stringify(cap.cartGet?.post ?? null));

await page.click('#btn_choose_location');
await page.waitForTimeout(3500);
const picker = page.locator('.lstProfile > div');
const n = await picker.count();
console.log('=== picker entries: %d ===', n);
for (let i = 0; i < n; i++) {
  const t = (await picker.nth(i).innerText()).replace(/\s+/g, ' ').trim();
  console.log('  [%d] %s', i, t.slice(0, 260));
}
// dump the modal container so we can see labels/radios/ids
const modalHtml = await page.locator('.lstProfile').first().innerHTML().catch(() => null);
if (modalHtml) writeFileSync('/tmp/picker-modal.html', modalHtml);
console.log('modal html bytes:', modalHtml ? modalHtml.length : 0);

// TARGET is the street substring shown in the picker (e.g. "205 Trần Phú")
const target = page.locator('.lstProfile > div', { hasText: TARGET }).first();
console.log('target entry present:', await target.count());

if (!CONFIRM) {
  console.log('PROBE ONLY (no click). Pass "confirm" to select the target entry.');
} else {
  await target.click();
  await page.waitForTimeout(1500);
  const confirmBtn = page.locator('button:visible').filter({ hasText: /^XÁC NHẬN$/i });
  console.log('confirm buttons:', await confirmBtn.count());
  if (await confirmBtn.count() === 1) {
    const ack = page.waitForResponse((r) => r.url() === prefix + 'SelectProfile', { timeout: 20000 });
    await confirmBtn.click();
    const r = await ack;
    console.log('SELECT ack status=%s ok=%s', r.status(), r.ok());
    await page.waitForTimeout(2500);
  }
  console.log('=== selectPosts ===');
  cap.selectPosts.forEach((p, i) => console.log(i, JSON.stringify(p), '=>', JSON.stringify(cap.selectResponses[i])));
  // re-read context: reload cart page fresh
  const reload = page.waitForResponse((r) => r.url() === prefix + 'get', { timeout: 40000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const rb = await (await reload).json();
  console.log('=== context after reload ===');
  console.log('cartId=%s TotalItemShow=%s', rb?.Value?.CartId, rb?.Value?.TotalItemShow);
  const fp = page.waitForResponse((r) => r.url().endsWith('/profile/full-profile'), { timeout: 20000 });
  await page.goto('https://www.bachhoaxanh.com/thong-tin-cua-toi', { waitUntil: 'domcontentloaded' }).catch(() => {});
  const f = await (await fp).json().catch(() => null);
  (f?.data?.addressReceiver ?? []).forEach((a) => console.log('after:', JSON.stringify(a).slice(0, 400)));
}
await browser.close();
console.log('done');
