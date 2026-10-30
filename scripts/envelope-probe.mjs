// Probe: establish the exact envelope + headers the BHX cart API requires.
// Stage 1: park on /gio-hang, capture the SPA's own OrderV2/get request (headers + body).
// Stage 2: replay it verbatim, then replay with variations, to find the minimal correct form.
// Read-only: no click, no cart mutation.
import { chromium } from 'playwright';
import { profileDirectory } from '../src/profile.mjs';

const CART = 'https://www.bachhoaxanh.com/gio-hang';

const ctx = await chromium.launchPersistentContext(profileDirectory(), {
  headless: true, serviceWorkers: 'block', viewport: { width: 1280, height: 900 },
  executablePath: process.env.BHX_CHROMIUM_PATH || undefined, locale: 'vi-VN',
});
const page = ctx.pages()[0] || await ctx.newPage();
for (const old of ctx.pages()) if (old !== page) await old.close();

let captured = null;
page.on('request', (req) => {
  if (!captured && req.url() === 'https://api.bachhoaxanh.com/gw/cart/api/OrderV2/get') {
    captured = { headers: req.headers(), post: req.postData() };
  }
});

await page.goto(CART, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(2000);

if (!captured) { console.log('NO_CAPTURE'); await ctx.close(); process.exit(1); }

const spaHeaders = {};
for (const [k, v] of Object.entries(captured.headers)) {
  if (['cookie'].includes(k)) spaHeaders[k] = `<${v.split(';').length} cookies>`;
  else spaHeaders[k] = String(v).slice(0, 70);
}
console.log('=== SPA cart-get request ===');
console.log('headers:', JSON.stringify(spaHeaders, null, 1));
console.log('body:', captured.post);

const results = await page.evaluate(async ({ post }) => {
  const API = 'https://api.bachhoaxanh.com/gw/cart/api/OrderV2/';
  const ADDR = 'https://api.bachhoaxanh.com/gw/cart/api/order/GetAllAddressUser';
  const PROFILE = 'https://api.bachhoaxanh.com/gw/bhx-api-identity/api/v1/profile/full-profile';
  const out = {};
  async function call(key, url, body, headers = {}) {
    const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    let j = null; try { j = await res.json(); } catch {}
    const val = j?.Value ?? j?.data ?? null;
    let shape = null;
    if (Array.isArray(val)) shape = `array(${val.length})`;
    else if (val && typeof val === 'object') shape = Object.keys(val).slice(0, 8).join(',');
    out[key] = { status: res.status, code: j?.ResultCode ?? j?.code ?? null, msg: (j?.Message || j?.message || '').slice(0, 40), shape };
  }
  const envelope = JSON.parse(post);
  await call('get_verbatim', API + 'get', envelope);
  await call('get_no_data', API + 'get', { ...envelope, data: undefined });
  await call('get_empty_body', API + 'get', {});
  await call('get_ward_only', API + 'get', { wardId: envelope.wardId });
  await call('addr_empty_body', ADDR, {});
  await call('addr_envelope_like', ADDR, { isNewModel: true });
  const cookie = document.cookie;
  const grab = (n) => { const m = cookie.match(new RegExp('(?:^|;\\s*)' + n + '=([^;]*)')); return m ? m[1] : null; };
  const deviceId = grab('ck_bhx_us_deviceId');
  await call('profile_no_device', PROFILE, {});
  await call('profile_with_device', PROFILE, {}, { deviceid: deviceId || '' });
  out._deviceId_present = Boolean(deviceId);
  out._localStorage_keys = Object.keys(localStorage).filter(k => /cart|store|ward|prov|address/i.test(k));
  out._bhx_cart_id = localStorage.getItem('bhx_cart_id');
  return out;
}, { post: captured.post });

console.log('=== replay results ===');
console.log(JSON.stringify(results, null, 1));
await ctx.close();
