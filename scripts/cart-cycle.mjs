import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allowedRequest, projectCart, contextSnapshot, productUI } from './cart-poc.mjs';

const ORIGIN = 'https://www.bachhoaxanh.com';
const PRODUCT = ORIGIN + '/rau-sach/cai-ngot-tui-400gr';
const API = 'https://api.bachhoaxanh.com';
const PROFILE = API + '/gw/bhx-api-identity/api/v1/profile/full-profile';
const CART = API + '/gw/cart/api/OrderV2/get';
const ADD = API + '/gw/cart/api/OrderV2/Add';
const CONTEXT = ['provinceId', 'wardId', 'districtId', 'storeId'];
const KEYS = [...CONTEXT, 'cartId', 'productId', 'quantity', 'productType', 'scenario', 'preDateBuy', 'listPromotion'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
const identity = value => (typeof value === 'string' && value.length > 0 && value.length <= 200 &&
  !/[\p{Cc}\p{Cf}]/u.test(value)) || (integer(value) && value > 0);
const stop = () => { throw new Error('PREFLIGHT_STOP'); };

export function validateAdd(raw, baseline) {
  try {
    if (typeof raw !== 'string' || raw.length > 4096) return false;
    const body = JSON.parse(raw);
    if (!body || Array.isArray(body) || typeof body !== 'object') return false;
    const keys = [...raw.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(match => JSON.parse(match[1]));
    return keys.length === KEYS.length && new Set(keys).size === KEYS.length &&
      Object.keys(body).length === KEYS.length && KEYS.every(key => Object.hasOwn(body, key)) &&
      CONTEXT.every(key => integer(body[key]) && (key === 'districtId' || body[key] > 0) && body[key] === baseline[key]) &&
      identity(body.cartId) && body.cartId === baseline.cartId && body.productId === 335195 && body.quantity === 1 &&
      integer(body.productType) && integer(body.scenario) && body.preDateBuy === '' &&
      Array.isArray(body.listPromotion) && body.listPromotion.length === 0;
  } catch { return false; }
}

export async function guardRequest(route, state, mainFrame) {
  const request = route.request();
  try {
    if (request.url() === ADD) {
      state.addObserved = true;
      state.addCount += 1;
      state.addValid = !state.failed && state.armed && state.addCount === 1 && request.method() === 'POST' &&
        !request.isNavigationRequest() && request.frame() === mainFrame &&
        /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers()['content-type'] || '') &&
        validateAdd(request.postData(), state.baseline);
      if (!state.addValid) state.failed = true;
      await route.abort();
      state.addAborted = true;
      return;
    }
    if (state.failed || request.frame() !== mainFrame ||
        !allowedRequest(request.url(), request.method(), request.isNavigationRequest(), request.resourceType())) {
      if (request.isNavigationRequest()) state.failed = true;
      await route.abort();
    } else await route.continue();
  } catch {
    state.failed = true;
    await route.abort().catch(() => {});
  }
}

export async function main() {
  process.umask(0o077);
  const state = { failed: false, armed: false, addObserved: false, addCount: 0, addValid: false, addAborted: false };
  const result = { context_verified: false, empty_verified: false, product_ui_5000: false,
    add_observed: false, add_valid: false, add_aborted: false, preflight_passed: false, mutations_enabled: false };
  let browser, page, profile, cart, delivery, snapshot;
  const pending = new Set();
  const drain = async () => { while (pending.size) await Promise.allSettled([...pending]); };
  const check = () => {
    if (state.failed) stop();
    if (!profile || !cart || !delivery) return false;
    const current = contextSnapshot(profile, cart, delivery);
    if (snapshot && snapshot !== current) stop();
    snapshot = current;
    return true;
  };
  const signal = () => { state.failed = true; void browser?.close().catch(() => {}); };
  const timer = setTimeout(signal, 120000);
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    if (!process.env.DISPLAY || process.argv.length !== 2) stop();
    const { chromium } = await import('playwright');
    browser = await chromium.launchPersistentContext(resolve(process.env.BHX_PROFILE_DIR ||
      join(homedir(), '.local/share/bhx-mcp/profile')), {
      headless: false, serviceWorkers: 'block', timeout: 30000,
      ...(process.env.BHX_CHROMIUM_PATH ? { executablePath: process.env.BHX_CHROMIUM_PATH } : {}),
    });
    await browser.route('**/*', route => guardRequest(route, state, page?.mainFrame()));
    page = await browser.newPage();
    for (const existing of browser.pages()) if (existing !== page) await existing.close();
    page.on('response', response => {
      if (![PROFILE, CART].includes(response.url())) return;
      const task = (async () => {
        if (!response.ok() || response.request().frame() !== page.mainFrame()) stop();
        const payload = await response.json();
        if (response.url() === PROFILE) {
          const next = { isSuccess: payload?.isSuccess, data: { entityId: payload?.data?.entityId,
            addressReceiver: payload?.data?.addressReceiver?.map(address => ({
              addressId: address?.addressId, provinceId: address?.provinceId, wardId: address?.wardId,
            })) } };
          if (profile && JSON.stringify(profile) !== JSON.stringify(next)) stop();
          profile = next;
        } else {
          if (!projectCart(payload).empty_verified) stop();
          const body = response.request().postDataJSON();
          const nextDelivery = Object.fromEntries(CONTEXT.map(key => [key, body?.[key]]));
          if (!CONTEXT.every(key => integer(nextDelivery[key]) && (key === 'districtId' || nextDelivery[key] > 0))) stop();
          const nextCart = { ShipAddressId: payload?.Value?.ShipAddressId, StoreId: payload?.Value?.StoreId,
            CartId: payload?.Value?.CartId };
          if (!identity(nextCart.CartId)) stop();
          const nextBaseline = { ...nextDelivery, cartId: nextCart.CartId };
          if ((cart && JSON.stringify(cart) !== JSON.stringify(nextCart)) ||
              (state.baseline && JSON.stringify(state.baseline) !== JSON.stringify(nextBaseline))) stop();
          cart = nextCart;
          delivery = nextDelivery;
          state.baseline = nextBaseline;
          result.empty_verified = true;
        }
        check();
      })().catch(() => { state.failed = true; });
      pending.add(task);
      void task.finally(() => pending.delete(task));
    });
    const warmup = ORIGIN + '/tim-kiem?key=' + encodeURIComponent('cải ngọt');
    if (!(await page.goto(warmup, { waitUntil: 'domcontentloaded', timeout: 30000 }))?.ok()) stop();
    const deadline = Date.now() + 30000;
    while (!check() && Date.now() < deadline) await page.waitForTimeout(100);
    await drain();
    if (!check() || page.url() !== warmup) stop();
    if (!(await page.goto(PRODUCT, { waitUntil: 'domcontentloaded', timeout: 30000 }))?.ok()) stop();
    const handle = await page.waitForFunction(productUI, undefined, { timeout: 30000 });
    await handle.dispose();
    await drain();
    if (!check() || page.url() !== PRODUCT || !(await page.evaluate(productUI))?.verified5000) stop();
    const purchase = page.locator('div.sticky').filter({
      has: page.getByRole('heading', { name: 'Cải ngọt túi 400g', exact: true }),
    }).filter({ visible: true }).locator(':scope > div.px-9px > button')
      .filter({ hasText: /^Mua$/ }).filter({ visible: true });
    if (await purchase.count() !== 1 || !await purchase.isEnabled()) stop();
    await drain();
    if (!check() || page.url() !== PRODUCT || !(await page.evaluate(productUI))?.verified5000) stop();
    result.context_verified = true;
    result.product_ui_5000 = true;
    state.armed = true;
    await purchase.click({ timeout: 10000 });
    const addDeadline = Date.now() + 10000;
    while (!state.addAborted && !state.failed && Date.now() < addDeadline) await page.waitForTimeout(100);
    await drain();
    if (!check() || page.url() !== PRODUCT) stop();
  } catch { state.failed = true; }
  finally {
    state.armed = false;
    clearTimeout(timer);
    try { await browser?.close(); } catch { state.failed = true; }
    await drain();
    process.removeListener('SIGINT', signal);
    process.removeListener('SIGTERM', signal);
  }
  result.add_observed = state.addObserved;
  result.add_valid = state.addValid;
  result.add_aborted = state.addAborted;
  result.preflight_passed = !state.failed && result.context_verified && result.empty_verified &&
    result.product_ui_5000 && state.addCount === 1 && state.addValid && state.addAborted;
  console.log(JSON.stringify(result));
  if (!result.preflight_passed) process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
