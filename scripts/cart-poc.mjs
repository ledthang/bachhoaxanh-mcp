import { mkdir, chmod, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { profileDirectory } from '../src/profile.mjs';
import { pathToFileURL } from 'node:url';
import { validateRefresh } from './cart-refresh.mjs';
import { matchContext } from './catalog-poc.mjs';

const ORIGIN = 'https://www.bachhoaxanh.com';
const PATH = '/rau-sach/cai-ngot-tui-400gr';
const API = 'https://api.bachhoaxanh.com';
const PROFILE = '/gw/bhx-api-identity/api/v1/profile/full-profile';
const CART = '/gw/cart/api/OrderV2/get';
const WARMUP = '/tim-kiem?key=' + encodeURIComponent('cải ngọt');
const SEARCH = '/gw/search/v2/DataSearch';
const DETAIL = '/gw/Product/GetProductDetail';
const READS = [CART, SEARCH, '/gw/Product/GetGalleryProduct',
  '/gw/Product/GetProductRelative', '/gw/Product/GetlstProductBuyTogether'];
const COLLECTIONS = ['Items', 'Products', 'CartItems', 'OrderItems', 'OrderDetails', 'ProductList', 'ListProduct', 'Lines', 'ListCartItemBuy'];
const CONTAINERS = ['Cart', 'Order', 'ShoppingCart', 'CartData', 'OrderData', 'Data', 'Groups', 'Carts', 'Orders'];
const TOTALS = ['TotalItemShow', 'Total', 'TotalAmount', 'TotalPrice', 'SubTotal'];
class CartError extends Error {}
const fail = code => { throw new CartError(code); };

export function safeDiagnostic(phase, error) {
  const phases = ['SETUP', 'WARMUP_NAVIGATION', 'WARMUP_CONTEXT', 'PRODUCT_NAVIGATION',
    'PRODUCT_HEADING', 'PRODUCT_UI', 'PRODUCT_UI_VALUE', 'PRODUCT_CONTEXT',
    'CART_NAVIGATION', 'CART_CONTEXT', 'BROWSER_CLOSE', 'OUTPUT_DIRECTORY', 'OUTPUT_OPEN',
    'OUTPUT_WRITE', 'OUTPUT_CLOSE', 'REQUEST_GUARD', 'RESPONSE_READ'];
  const names = ['Error', 'TimeoutError', 'TypeError', 'SyntaxError', 'RangeError'];
  const codes = ['EEXIST', 'EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EIO', 'EROFS'];
  return {
    phase: phases.includes(phase) ? phase : 'UNKNOWN',
    error_name: error instanceof CartError ? 'CartError' : names.includes(error?.name) ? error.name : 'OTHER',
    ...(codes.includes(error?.code) ? { error_code: error.code } : {}),
  };
}

export function allowedRequest(value, method, navigation, resourceType, observedCartPath = null) {
  const url = new URL(value);
  if (url.username || url.password || url.hash) return false;
  if (navigation) return method === 'GET' && url.origin === ORIGIN &&
    ((url.pathname === '/tim-kiem' && url.searchParams.size === 1 && url.searchParams.get('key') === 'cải ngọt') ||
      ((url.pathname === PATH || (observedCartPath === '/gio-hang' && url.pathname === observedCartPath)) && !url.search));
  if (url.origin === API && url.pathname === DETAIL) {
    const params = url.searchParams;
    return method === 'GET' && (
      params.get('productId') === '335195' ||
      (params.get('CategoryUrl') === 'rau-sach' && params.get('ProductUrl') === 'cai-ngot-tui-400gr')) &&
      [...params].every(([key, entry]) => params.getAll(key).length === 1 && (
        key === 'CategoryUrl' ? entry === 'rau-sach' :
        key === 'ProductUrl' ? entry === 'cai-ngot-tui-400gr' :
        ['productId', 'provinceId', 'wardId', 'storeId', 'districtId'].includes(key) &&
        /^(?:0|[1-9]\d*)$/.test(entry) && Number.isSafeInteger(Number(entry)) &&
        (key !== 'productId' || entry === '335195') &&
        (key === 'districtId' || Number(entry) > 0)));
  }
  if (method === 'GET' && url.origin === 'https://bhxcdn.vn' &&
      url.pathname === '/bhx/product-fe/cart/home/_next/public/static/js/checkCDN.js' && !url.search) return true;
  if (method === 'GET' && ((url.origin === API && url.pathname === '/User/GetIpCustomer' && !url.search) ||
      (url.origin === 'https://api.ipify.org' && url.pathname === '/' && [...url.searchParams].every(([k,v]) => k === 'format' && v === 'json')))) return true;
  // Site-owned session refresh only; login, OTP and logout stay blocked.
  if (url.origin === API && url.pathname === '/gw/bhx-api-identity/api/v1/auth/aio/refresh-token')
    return method === 'POST' && !url.search;
  if (url.origin === API) return !url.search && ((url.pathname === PROFILE && method === 'GET') ||
    (READS.includes(url.pathname) && method === 'POST'));
  return method === 'GET' && !url.search &&
    ['https://bhxcdn.vn', 'https://cdnv2.tgdd.vn'].includes(url.origin) &&
    url.pathname.startsWith('/bhx/product-fe/cart/') &&
    ['script', 'stylesheet', 'image', 'font'].includes(resourceType);
}

export function blockedKnownRequest(value, method) {
  const url = new URL(value);
  return url.origin === API && [PROFILE, DETAIL, ...READS].includes(url.pathname) &&
    ['GET', 'POST', 'OPTIONS', 'HEAD', 'PUT', 'PATCH', 'DELETE'].includes(method)
    ? { route: url.pathname, method } : null;
}

export function projectCart(payload) {
  const cart = payload?.Value;
  if (payload?.HttpCode !== 200 || payload?.ResultCode !== 0 || !cart || typeof cart !== 'object' || Array.isArray(cart) ||
      !['TotalItemShow', 'GroupSOStep2InCart', 'CartTotal'].every(key => Object.hasOwn(cart, key)) ||
      !Number.isSafeInteger(cart.TotalItemShow) || cart.TotalItemShow < 0) fail('CART_SCHEMA_UNVERIFIED');
  if (cart.TotalItemShow !== 0) fail('EXISTING_ITEMS_STOP');
  const inactive = cart.GroupCartOff;
  if (inactive != null) {
    if (typeof inactive !== 'object' || Array.isArray(inactive) ||
        !Array.isArray(inactive.ListCartItemBuy)) fail('CART_SCHEMA_UNVERIFIED');
    if (inactive.ListCartItemBuy.length) fail('EXISTING_ITEMS_STOP');
  }
  const groups = cart.GroupSOStep2InCart;
  if (groups !== null && !Array.isArray(groups)) fail('CART_SCHEMA_UNVERIFIED');
  if (groups?.length) fail('EXISTING_ITEMS_STOP');
  if (!cart.CartTotal || typeof cart.CartTotal !== 'object' || Array.isArray(cart.CartTotal) ||
      !Object.hasOwn(cart.CartTotal, 'Total') || !Number.isSafeInteger(cart.CartTotal.Total)) fail('CART_SCHEMA_UNVERIFIED');
  if (cart.CartTotal.Total !== 0) fail('UNEXPECTED_TOTAL_STOP');
  const collections = { GroupSOStep2InCart: { type: groups === null ? 'null' : 'array', empty: true } };
  const totals = { 'CartTotal.Total': 0 };
  const containers = {};
  const visit = (node, prefix, depth) => {
    for (const key of COLLECTIONS) {
      if (!Object.hasOwn(node, key)) continue;
      if (!Array.isArray(node[key])) fail('CART_SCHEMA_UNVERIFIED');
      if (node[key].length) fail('EXISTING_ITEMS_STOP');
      collections[prefix + key] = { type: 'array', empty: true };
    }
    for (const key of TOTALS) {
      if (!Object.hasOwn(node, key)) continue;
      if (!Number.isSafeInteger(node[key]) || node[key] < 0) fail('CART_SCHEMA_UNVERIFIED');
      if (node[key] !== 0) fail('UNEXPECTED_TOTAL_STOP');
      totals[prefix + key] = node[key];
    }
    for (const key of CONTAINERS) {
      if (!Object.hasOwn(node, key)) continue;
      const value = node[key];
      const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      containers[prefix + key] = { type, ...(type === 'array' ? { empty: value.length === 0 } : {}) };
      if (type === 'array' && value.length) fail('CART_SCHEMA_UNVERIFIED');
      if (!['null', 'array', 'object'].includes(type) ||
          (type === 'object' && depth >= 2 && Object.keys(value).length)) fail('CART_SCHEMA_UNVERIFIED');
      if (type === 'object' && depth < 2) visit(value, prefix + key + '.', depth + 1);
    }
  };
  visit(cart, '', 0);
  visit(cart.CartTotal, 'CartTotal.', 0);
  return { reported_empty: true, empty_verified: true, collections, totals, containers,
    schema_status: 'EMPTY_COLLECTIONS_LINE_SCHEMA_UNKNOWN',
    line_schema_verified: false, mutations_enabled: false };
}

export function productUI(diagnostic = false) {
  const rejected = reason => diagnostic === true ? { selector_failure: reason } : false;
  const visible = element => element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility === 'visible';
  const regions = [...document.querySelectorAll('div.sticky')]
    .filter(element => visible(element) && [...element.querySelectorAll('h1')]
      .some(heading => visible(heading) && heading.textContent.trim() === 'Cải ngọt túi 400g'));
  const region = regions.length === 1 ? regions[0] : null;
  if (!region) return rejected('MAIN_REGION_NOT_UNIQUE');
  const primary = region ? [...region.querySelectorAll(':scope > :first-child [class*="text-24"]')].filter(visible) : [];
  const crossed = region ? [...region.querySelectorAll(':scope > :first-child [class*="line-through"]')].filter(visible) : [];
  const price = element => /^(?:\d{1,3}(?:\.\d{3})+|\d+)\s*[₫đ]$/.test(element.textContent.trim())
    ? Number(element.textContent.replace(/\D/g, '')) : null;
  if (primary.length !== 1) return rejected('PRIMARY_PRICE_NOT_UNIQUE');
  if (primary[0].closest('[class*="line-through"]')) return rejected('PRIMARY_PRICE_CROSSED');
  if (price(primary[0]) === null) return rejected('PRIMARY_PRICE_FORMAT');
  const purchase = [...region.querySelectorAll(':scope > div.px-9px > button')].filter(element =>
    visible(element) && element.textContent.trim() === 'Mua');
  if (purchase.length !== 1) return rejected('MAIN_PURCHASE_NOT_UNIQUE');
  const verified5000 = price(primary[0]) === 5000;
  return {
    main_region_unique: true, main_purchase_button_unique: true, primary_price_verified: verified5000, primary5000: verified5000, verified5000,
    primary_crossed_price_vnd: crossed.length === 1 ? price(crossed[0]) : null,
    cart_paths: [...new Set([...document.querySelectorAll('a[href]')].filter(visible).flatMap(element => {
      const url = new URL(element.href, location.href);
      return url.origin === location.origin && url.pathname === '/gio-hang' &&
        !url.username && !url.password && !url.search && !url.hash ? [url.pathname] : [];
    }))],
  };
}

export function contextSnapshot(profile, cart, delivery) {
  if (!matchContext(profile, cart, delivery, delivery).profile_cart_match) fail('CONTEXT_UNVERIFIED');
  return JSON.stringify([profile.data.entityId, cart.ShipAddressId, cart.StoreId,
    delivery.provinceId, delivery.wardId].map(String));
}

async function main() {
  process.umask(0o077);
  let browser;
  let fatal;
  let profile;
  let cart;
  let delivery;
  let baseline;
  let projection;
  let productDetailRequest = null;
  let observedCartPath = null;
  let cartReads = 0;
  let refreshBaseline, refreshRequest;
  let refreshVerified = false;
  const navigationReads = new Set();
  let navigationReadVerified = false;
  let phase = 'SETUP';
  let page;
  const diagnostics = { profile_observed: false, cart_observed: false };
  const blocked = new Map();
  const pending = new Set();
  let closing;
  const close = () => {
    if (!browser) return Promise.resolve();
    return closing ||= Promise.resolve().then(() => browser.close());
  };
  const drain = async () => {
    while (pending.size) await Promise.allSettled([...pending]);
  };
  const stop = code => { fatal ||= new CartError(code); };
  const signal = () => stop('INTERRUPTED');
  const check = () => {
    if (fatal) throw fatal;
    if (!profile || !cart || !delivery) return false;
    const current = contextSnapshot(profile, cart, delivery);
    if (baseline && current !== baseline) fail('CONTEXT_CHANGED');
    baseline = current;
    return true;
  };
  const timer = setTimeout(() => { stop('TIMEOUT'); void close().catch(() => {}); }, 180000);
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    if (!process.env.DISPLAY || process.argv.length !== 2) fail('HEADED_DISCOVERY_ONLY');
    const directory = profileDirectory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const { chromium } = await import('playwright');
    browser = await chromium.launchPersistentContext(directory, {
      headless: false, serviceWorkers: 'block', timeout: 30000, viewport: { width: 1280, height: 900 },
      ...(process.env.BHX_CHROMIUM_PATH ? { executablePath: process.env.BHX_CHROMIUM_PATH } : {}),
    });
    page = await browser.newPage();
    for (const existing of browser.pages()) if (existing !== page) await existing.close();
    await browser.route('**/*', async route => {
      try {
        const request = route.request();
        if (request.url() === API + '/gw/cart/api/OrderV2/getAfter') {
          if (!fatal && observedCartPath === '/gio-hang' && !refreshRequest &&
              request.frame() === page.mainFrame() && request.frame().url() === ORIGIN + '/gio-hang' &&
              !request.isNavigationRequest() &&
              request.method() === 'POST' && validateRefresh(request.postData(), refreshBaseline)) {
            refreshRequest = request;
            await route.continue();
          } else { stop('REFRESH_REQUEST_UNVERIFIED'); await route.abort(); }
          return;
        }
        if (fatal || (request.isNavigationRequest() && request.frame() !== page.mainFrame()) ||
            !allowedRequest(request.url(), request.method(), request.isNavigationRequest(), request.resourceType(), observedCartPath)) {
          const known = blockedKnownRequest(request.url(), request.method());
          if (known) blocked.set(`${known.method} ${known.route}`, known);
          if (request.isNavigationRequest() && request.frame() === page.mainFrame()) stop('NAVIGATION_CHANGED');
          await route.abort();
        } else {
          if (request.url() === API + CART && ['CART_NAVIGATION', 'CART_CONTEXT'].includes(phase) && request.method() === 'POST' && !request.isNavigationRequest() && request.postData() &&
              request.frame() === page.mainFrame() && request.frame().url() === ORIGIN + '/gio-hang') navigationReads.add(request);
          await route.continue();
        }
        if (!fatal && new URL(request.url()).origin === API && new URL(request.url()).pathname === DETAIL &&
            allowedRequest(request.url(), request.method(), false, request.resourceType())) {
          productDetailRequest = { method: request.method(),
            query_parameter_names: [...new Set(new URL(request.url()).searchParams.keys())].sort() };
        }
      } catch (error) {
        diagnostics.request_failure ||= safeDiagnostic('REQUEST_GUARD', error);
        stop('REQUEST_GUARD_FAILED');
        await route.abort().catch(() => {});
      }
    });
    page.on('response', response => {
      const url = new URL(response.url());
      if (response.url() === API + '/gw/cart/api/OrderV2/getAfter') {
        const task = (async () => {
          if (response.request() !== refreshRequest || !response.ok()) fail('REFRESH_READ_FAILED');
          const payload = await response.json();
          if (payload?.Value?.CartId !== refreshBaseline?.cartId ||
              payload?.Value?.ShipAddressId !== cart?.ShipAddressId ||
              payload?.Value?.StoreId !== cart?.StoreId) fail('CONTEXT_CHANGED');
          projection = projectCart(payload);
          refreshVerified = true;
        })().catch(() => stop('REFRESH_READ_FAILED'));
        pending.add(task); void task.finally(() => pending.delete(task));
        return;
      }
      if (url.origin !== API || ![PROFILE, CART].includes(url.pathname)) return;
      const task = (async () => {
        if (response.request().frame() !== page.mainFrame()) fail('READ_FAILED');
        diagnostics[url.pathname === PROFILE ? 'profile_observed' : 'cart_observed'] = true;
        if (!response.ok()) fail('READ_FAILED');
        const payload = await response.json();
        if (url.pathname === PROFILE) {
          const next = { isSuccess: payload?.isSuccess, data: { entityId: payload?.data?.entityId,
            addressReceiver: payload?.data?.addressReceiver?.map(address => ({
              addressId: address?.addressId, provinceId: address?.provinceId, wardId: address?.wardId,
            })) } };
          if (profile && JSON.stringify(profile) !== JSON.stringify(next)) fail('CONTEXT_CHANGED');
          profile = next;
        } else {
          const body = response.request().postDataJSON();
          const nextDelivery = Object.fromEntries(['provinceId', 'wardId', 'storeId'].map(key => [key, body?.[key]]));
          const nextCart = { ShipAddressId: payload?.Value?.ShipAddressId, StoreId: payload?.Value?.StoreId };
          if ((delivery && JSON.stringify(delivery) !== JSON.stringify(nextDelivery)) ||
              (cart && JSON.stringify(cart) !== JSON.stringify(nextCart))) fail('CONTEXT_CHANGED');
          projection = projectCart(payload);
          const nextRefresh = { ...Object.fromEntries(['provinceId', 'districtId', 'wardId', 'storeId']
            .map(k => [k, body?.[k]])), cartId: payload?.Value?.CartId };
          if (refreshBaseline && JSON.stringify(refreshBaseline) !== JSON.stringify(nextRefresh)) fail('CONTEXT_CHANGED');
          refreshBaseline = nextRefresh;
          cart = nextCart;
          delivery = nextDelivery;
          cartReads += 1;
          if (navigationReads.has(response.request())) navigationReadVerified = true;
        }
        check();
      })().catch(error => {
        diagnostics.response_failure ||= safeDiagnostic('RESPONSE_READ', error);
        stop(error instanceof CartError ? error.message : 'READ_SCHEMA_FAILED');
      });
      pending.add(task);
      void task.finally(() => pending.delete(task));
    });
    phase = 'WARMUP_NAVIGATION';
    const warmup = await page.goto(ORIGIN + WARMUP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!warmup?.ok()) fail('NAVIGATION_FAILED');
    phase = 'WARMUP_CONTEXT';
    const deadline = Date.now() + 30000;
    while (!check() && Date.now() < deadline) await page.waitForTimeout(100);
    await drain();
    if (!check()) fail('AUTHENTICATED_CART_NOT_OBSERVED');
    if (page.url() !== ORIGIN + WARMUP) fail('CONTEXT_UNVERIFIED');
    diagnostics.warmup_context_verified = true;
    phase = 'PRODUCT_NAVIGATION';
    const navigation = await page.goto(ORIGIN + PATH, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!navigation?.ok()) fail('NAVIGATION_FAILED');
    phase = 'PRODUCT_HEADING';
    await page.getByRole('heading', { name: 'Cải ngọt túi 400g', exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    await drain();
    if (!check()) fail('CONTEXT_UNVERIFIED');
    phase = 'PRODUCT_UI';
    const uiHandle = await page.waitForFunction(productUI, undefined, { timeout: 30000 });
    phase = 'PRODUCT_UI_VALUE';
    const ui = await uiHandle.jsonValue();
    await uiHandle.dispose();
    phase = 'PRODUCT_CONTEXT';
    await drain();
    if (!check() || page.url() !== ORIGIN + PATH) fail('CONTEXT_UNVERIFIED');
    // Cart route was independently observed on the website; verify its full read flow.
    if (ui.cart_paths.includes('/gio-hang') || await page.locator('#cart-icon').count() === 1) {
      observedCartPath = '/gio-hang';
      const previousReads = cartReads;
      phase = 'CART_NAVIGATION';
      const cartPage = await page.goto(ORIGIN + observedCartPath, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!cartPage?.ok()) fail('NAVIGATION_FAILED');
      phase = 'CART_CONTEXT';
      const cartDeadline = Date.now() + 10000;
      while ((!navigationReadVerified || !refreshVerified) && Date.now() < cartDeadline) {
        check();
        await page.waitForTimeout(100);
      }
      await drain();
      if (!check() || page.url() !== ORIGIN + observedCartPath) fail('CONTEXT_UNVERIFIED');
      if (!navigationReadVerified) fail('CART_ROUTE_READ_NOT_OBSERVED');
      if (!refreshVerified) fail('REFRESH_NOT_OBSERVED');
      diagnostics.cart_route_read_observed = cartReads > previousReads;
    }

    if (!refreshVerified || !navigationReadVerified) fail('CART_ROUTE_READ_NOT_OBSERVED');
    phase = 'BROWSER_CLOSE';
    await close();
    await drain();
    check();
    phase = 'OUTPUT_DIRECTORY';
    await mkdir('data', { recursive: true, mode: 0o700 });
    phase = 'OUTPUT_OPEN';
    const output = await open(resolve('data/cart-discovery.json'), 'wx', 0o600);
    try {
      phase = 'OUTPUT_WRITE';
      await output.writeFile(JSON.stringify({ outcome: 'READ_ONLY_DISCOVERY', product_id: 335195,
        approved_unit_price_vnd: 5000, verified5000: ui.verified5000, profile_cart_match: true, cart: projection, ui,
        readonly_product_detail_request: productDetailRequest,
        cart_refresh_verified: refreshVerified,
        next_task: 'Review observed cart/UI schema before enabling any mutation.' }, null, 2) + '\n');
    } finally {
      try { await output.close(); } catch (error) {
        diagnostics.output_close_failure = safeDiagnostic('OUTPUT_CLOSE', error);
        throw error;
      }
    }
    console.log('READ_ONLY_DISCOVERY: data/cart-discovery.json; mutations disabled.');
  } catch (error) {
    diagnostics.failure = safeDiagnostic(phase, error);
    if (phase === 'PRODUCT_UI' && page) {
      try {
        const probe = await page.evaluate(productUI, true);
        const reasons = ['MAIN_REGION_NOT_UNIQUE', 'PRIMARY_PRICE_NOT_UNIQUE',
          'PRIMARY_PRICE_CROSSED', 'PRIMARY_PRICE_FORMAT', 'MAIN_PURCHASE_NOT_UNIQUE'];
        diagnostics.selector_failure = reasons.includes(probe?.selector_failure)
          ? probe.selector_failure : 'NOT_REPRODUCED';
      } catch (probeError) {
        diagnostics.selector_probe_failure = safeDiagnostic('PRODUCT_UI', probeError);
      }
    }
    console.error('CART_POC_STOP: ' + (error instanceof CartError ? error.message : 'DISCOVERY_FAILED'));
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    try { await close(); } catch (error) {
      diagnostics.close_failure = safeDiagnostic('BROWSER_CLOSE', error);
      console.error('CART_POC_STOP: CLOSE_FAILED');
      process.exitCode = 1;
    }
    await drain();
    console.error('CART_POC_DIAGNOSTICS: ' + JSON.stringify({ ...diagnostics,
      blocked_known_api_requests: [...blocked.values()] }));
    process.removeListener('SIGINT', signal);
    process.removeListener('SIGTERM', signal);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
