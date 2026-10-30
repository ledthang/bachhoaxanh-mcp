// One-shot: remove every line currently in the cart and verify it ends empty.
import { chromium } from 'playwright';
import { profileDirectory } from '../src/profile.mjs';
const API = 'https://api.bachhoaxanh.com';
const PREFIX = API + '/gw/cart/api/OrderV2/';
const ctx = await chromium.launchPersistentContext(profileDirectory(), {
  headless: true, serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, locale: 'vi-VN',
  executablePath: process.env.BHX_CHROMIUM_PATH || undefined,
});
const page = ctx.pages()[0] || await ctx.newPage();
for (const old of ctx.pages()) if (old !== page) await old.close();
let env = null;
page.on('request', (r) => { if (!env && r.url() === PREFIX + 'get') env = JSON.parse(r.postData() || '{}'); });
await page.goto('https://www.bachhoaxanh.com/gio-hang', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(1500);
const g = page.waitForRequest((r) => r.url() === PREFIX + 'get', { timeout: 30000 });
await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
await g;
const out = await page.evaluate(async ({ PREFIX, env }) => {
  const post = async (op, body) => { const res = await fetch(PREFIX + op, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); let j = null; try { j = await res.json(); } catch {} return j; };
  const get = async () => { const j = await post('get', { ...env }); const vv = j?.Value || {}; return [...(vv.GroupSOStep2InCart || []), ...(vv.GroupCartOff ? [vv.GroupCartOff] : [])].flatMap((g) => g.ListCartItemBuy || []); };
  const log = [];
  let items = await get();
  log.push({ stage: 'start', n: items.length, ids: items.map((i) => ({ gid: i.GuildId, pid: i.Id })) });
  for (const it of items) {
    const j = await post('Remove', { token: '', us: '', ...env, isNewModel: true, data: { cartId: env.data.cartId, guid: it.GuildId, reloadShiping: true, isSubmitOrder: false, wardId: env.wardId } });
    log.push({ stage: 'remove', gid: it.GuildId, code: j?.ResultCode });
  }
  const after = await get();
  log.push({ stage: 'final', n: after.length });
  return log;
}, { PREFIX, env });
console.log(JSON.stringify(out, null, 1));
await ctx.close();
