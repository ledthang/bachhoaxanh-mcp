// Probe: Add -> read -> UpdateCartItem -> read -> Remove -> read, on one known product,
// using the HEAD-verified mutation envelope (location + cartId/guid). Cart returns to empty.
import { chromium } from 'playwright';
import { profileDirectory } from '../src/profile.mjs';

const API = 'https://api.bachhoaxanh.com';
const PREFIX = API + '/gw/cart/api/OrderV2/';
const PID = 299256;

const ctx = await chromium.launchPersistentContext(profileDirectory(), {
  headless: true, serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, locale: 'vi-VN',
  executablePath: process.env.BHX_CHROMIUM_PATH || undefined,
});
const page = ctx.pages()[0] || await ctx.newPage();
for (const old of ctx.pages()) if (old !== page) await old.close();

let loc = null;
page.on('request', (r) => {
  if (!loc && r.url() === PREFIX + 'get') loc = JSON.parse(r.postData() || '{}');
});
await page.goto('https://www.bachhoaxanh.com/gio-hang', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(1500);
const waitGet = page.waitForRequest((r) => r.url() === PREFIX + 'get', { timeout: 30000 });
await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
await waitGet;
if (!loc) { console.log('NO_LOC'); await ctx.close(); process.exit(1); }
const CTX = { provinceId: loc.provinceId, districtId: loc.districtId, wardId: loc.wardId, storeId: loc.storeId, cartId: loc.data.cartId };
console.log('CTX:', JSON.stringify(CTX));

const out = await page.evaluate(async ({ PREFIX, CTX, PID }) => {
  const post = async (op, body) => {
    const res = await fetch(PREFIX + op, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let j = null; try { j = await res.json(); } catch {}
    const v = j?.Value ?? {};
    const groups = [...(v.GroupSOStep2InCart || []), ...(v.GroupCartOff ? [v.GroupCartOff] : [])];
    const items = groups.flatMap((g) => g.ListCartItemBuy || []);
    return { code: j?.ResultCode ?? null, msg: (j?.Message || '').slice(0, 30), n: items.length, lines: items.map((i) => ({ id: i.Id, gid: i.GuildId, q: i.QuantityInCart, p: i.Price, t: i.Total })) };
  };
  const r = {};
  r.get0 = await post('get', { ...CTX, isNewModel: true, data: { cartId: CTX.cartId, infoApp: 'webnew', wardId: CTX.wardId } });
  r.add = await post('Add', { ...CTX, productId: PID, quantity: 1, productType: 0, scenario: 0, preDateBuy: '', listPromotion: [] });
  const gid = r.add.lines[0]?.gid;
  r.get_after_add = await post('get', { ...CTX, data: { cartId: CTX.cartId, infoApp: 'webnew', wardId: CTX.wardId } });
  r.update = gid ? await post('UpdateCartItem', { ...CTX, guid: gid, quantity: 3, note: '' }) : null;
  r.get_after_update = await post('get', { ...CTX, data: { cartId: CTX.cartId, infoApp: 'webnew', wardId: CTX.wardId } });
  r.remove = gid ? await post('Remove', { token: '', us: '', ...CTX, isNewModel: true, data: { cartId: CTX.cartId, guid: gid, reloadShiping: true, isSubmitOrder: false, productId: PID, wardId: CTX.wardId } }) : null;
  r.get_after_remove = await post('get', { ...CTX, data: { cartId: CTX.cartId, infoApp: 'webnew', wardId: CTX.wardId } });
  return r;
}, { PREFIX, CTX, PID });

console.log(JSON.stringify(out, null, 1));
await ctx.close();
