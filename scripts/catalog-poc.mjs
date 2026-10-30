import { mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { profileDirectory } from '../src/profile.mjs';
import { pathToFileURL } from 'node:url';

export const QUERIES = Object.freeze(['ức gà', 'thịt heo', 'cá hồi', 'cải ngọt', 'sữa tươi']);
const TIMEOUT = 30000;
class CatalogError extends Error {}
const fail = code => { throw new CatalogError(code); };
const validId = value => (typeof value === 'number' || typeof value === 'string') &&
  /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const sameId = (left, right) => validId(left) && validId(right) && String(left) === String(right);
const contextKeys = ['provinceId', 'wardId', 'storeId'];
const validContext = value => contextKeys.every(key => validId(value?.[key]));
const sameContext = (left, right) => contextKeys.every(key => sameId(left?.[key], right?.[key]));

export function matchContext(profile, cart, delivery, search) {
  const addresses = profile?.data?.addressReceiver;
  const profile_cart_match = profile?.isSuccess === true && validId(profile?.data?.entityId) &&
    validId(cart?.ShipAddressId) && validId(cart?.StoreId) && validContext(delivery) &&
    sameId(cart.StoreId, delivery.storeId) && Array.isArray(addresses) &&
    addresses.filter(address => sameId(address?.addressId, cart.ShipAddressId) &&
      sameId(address?.provinceId, delivery.provinceId) && sameId(address?.wardId, delivery.wardId)).length === 1;
  return {
    profile_cart_match: Boolean(profile_cart_match),
    search_cart_match: validContext(search) && validContext(delivery) &&
      sameContext(search, delivery) && sameId(search.storeId, cart?.StoreId),
  };
}

const text = value => typeof value === 'string' && value.length > 0 && value.length <= 300 &&
  !/[\p{Cc}\p{Cf}]|https?:\/\/|@/u.test(value);
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const productPath = value => typeof value === 'string' && value.length <= 300 &&
  /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)+$/.test(value);

function campaignProjection(product, now) {
  if (product.isSpecialOffer != null && product.isSpecialOffer !== false) fail('PRODUCTS_SCHEMA_INVALID');
  if (product.specialOfferInfo != null || product.campaignInfoFS != null || product.activeFS ||
      product.isComingSoonFS || product.isBoxFS || product.isBoxSO) fail('PRODUCTS_SCHEMA_INVALID');
  if (product.scenario != null && product.scenario !== 0 && product.scenario !== 1) fail('PRODUCTS_SCHEMA_INVALID');
  const campaigns = product.lstCampaingInfo;
  if (campaigns == null) {
    if (product.scenario === 1) fail('PRODUCTS_SCHEMA_INVALID');
    return {};
  }
  if (!Array.isArray(campaigns) || campaigns.length > 1) fail('PRODUCTS_SCHEMA_INVALID');
  if (!campaigns.length && product.scenario !== 1) return {};
  if (product.scenario !== 1 || campaigns.length !== 1 || product.productPrices.length !== 1) return { price_status:'campaign-selection-unverified', promotion:{status:'unknown'} };
  const campaign = campaigns[0];
  const timestamp = value => typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  const instant = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : timestamp(now) ? Date.parse(now) : NaN;
  const price = campaign?.productPrice;
  if (!Number.isFinite(instant) || !timestamp(campaign?.startTime) || !timestamp(campaign?.dueTime) ||
      Date.parse(campaign.startTime) >= Date.parse(campaign.dueTime) ||
      !Number.isSafeInteger(campaign.remainingQuantity) || campaign.remainingQuantity < 0 ||
      !Number.isSafeInteger(campaign.maxQuantityOrder) || campaign.maxQuantityOrder < 1 ||
      !amount(price?.price) || !amount(price?.sysPrice) || price.price > price.sysPrice ||
      typeof price?.isCanBuy !== 'boolean') fail('PRODUCTS_SCHEMA_INVALID');
  const active = instant >= Date.parse(campaign.startTime) && instant <= Date.parse(campaign.dueTime) && campaign.remainingQuantity > 0;
  return { display_price: Math.round(active ? price.price : product.productPrices[0].price),
    price_status: 'display-only-cart-payable-unverified',
    promotion: { status: active ? 'active' : 'inactive', start_time: campaign.startTime,
      due_time: campaign.dueTime, remaining_quantity: campaign.remainingQuantity,
      maximum_quantity: campaign.maxQuantityOrder } };
}

export function projectProducts(payload, { now = Date.now() } = {}) {
  const products = payload?.data?.products;
  if (!Array.isArray(products)) fail('PRODUCTS_SCHEMA_INVALID');
  const projected = products.map(product => {
    const name = product?.fullName || product?.name;
    if (!validId(product?.id) || !text(name) || !text(product?.unit) || !productPath(product?.url) ||
        !Array.isArray(product?.productPrices) || !product.productPrices.length) fail('PRODUCTS_SCHEMA_INVALID');
    const prices = product.productPrices.map(price => {
      if (!amount(price?.price) || !amount(price?.sysPrice) || typeof price?.isCanBuy !== 'boolean') {
        fail('PRODUCTS_SCHEMA_INVALID');
      }
      return { price: price.price, list_price: price.sysPrice, can_buy: price.isCanBuy };
    });
    return { id: Number(product.id), name, path: product.url, unit: product.unit, prices,
      ...(() => { try { return campaignProjection(product, now); } catch { return {price_status:'campaign-selection-unverified',promotion:{status:'unknown'}}; } })() };
  });
  return projected;
}

function searchPage(value, query) {
  try {
    const url = new URL(value);
    return url.origin === 'https://www.bachhoaxanh.com' && url.pathname === '/tim-kiem' &&
      url.searchParams.size === 1 && url.searchParams.get('key') === query && !url.hash;
  } catch { return false; }
}

function routeKind(value) {
  const url = new URL(value);
  if (url.origin !== 'https://api.bachhoaxanh.com') return null;
  if (url.pathname.endsWith('/profile/full-profile')) return 'profile';
  if (url.pathname.endsWith('/OrderV2/get')) return 'cart';
  if (url.pathname.toLowerCase() === '/gw/search/v2/datasearch') return 'search';
  return null;
}

function snapshot(profile, cart, delivery, search) {
  const matches = matchContext(profile, cart, delivery, search);
  if (!matches.profile_cart_match || !matches.search_cart_match) fail('CONTEXT_UNVERIFIED');
  return JSON.stringify([profile.data.entityId, cart.ShipAddressId, cart.StoreId,
    delivery.provinceId, delivery.wardId].map(String));
}

async function compareCard(page, product) {
  const links = page.locator(`.box_product a[href="${product.path}"]:visible`);
  await links.first().waitFor({ state: 'visible', timeout: TIMEOUT });
  return links.evaluateAll((elements, prices) => {
    const cards = [...new Set(elements.map(element => element.closest('.box_product')))];
    if (cards.length !== 1 || !cards[0]) return {
      exact_product_path_match: false, api_price_token_match: false, api_list_price_token_match: false,
      purchase_control_present: false, promotion_present: false,
    };
    const card = cards[0];
    const content = card.textContent || '';
    const tokens = (content.match(/\d[\d.,]*\s*(?:₫|đ)/gi) || [])
      .map(token => Number(token.replace(/\D/g, '')));
    return {
      exact_product_path_match: true,
      api_price_token_match: prices.some(price => tokens.includes(Math.round(price.price))),
      api_list_price_token_match: prices.some(price => tokens.includes(Math.round(price.list_price))),
      purchase_control_present: [...card.querySelectorAll('button')].some(button =>
        /^(mua|chọn mua|thêm vào giỏ)$/i.test(button.textContent.trim()) && !button.disabled),
      promotion_present: /khuyến mãi|mua .*tặng|giảm|suất|tối đa/i.test(content),
    };
  }, product.display_price == null ? product.prices : [{ price: product.display_price, list_price: product.prices[0].list_price }]);
}

export function queryCapture(page, query, baseline, pending) {
  let barrier = false;
  let fatal;
  let profile;
  let cart;
  let delivery;
  let search;
  let products;
  let acceptedSearch;
  const requests = new Map();
  const inflight = new Set();
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  ready.catch(() => {});
  const stop = error => {
    fatal ||= error instanceof CatalogError ? error : new CatalogError('CAPTURE_FAILED');
    rejectReady(fatal);
  };
  const timer = setTimeout(() => stop(new CatalogError('CAPTURE_TIMEOUT')), TIMEOUT);
  const check = () => {
    if (fatal) throw fatal;
    if (!searchPage(page.url(), query)) fail('NAVIGATION_CHANGED');
    if (!profile || !cart || !search || !products || inflight.size) return false;
    const current = snapshot(profile, cart, delivery, search);
    if (baseline && current !== baseline) fail('CONTEXT_CHANGED');
    return current;
  };
  const owns = request => {
    try { return request.frame() === page.mainFrame(); } catch { return false; }
  };
  const onRequest = request => {
    try {
      if (!owns(request)) return;
      if (request.isNavigationRequest()) {
        if (!searchPage(request.url(), query) || barrier) fail('NAVIGATION_CHANGED');
        barrier = true;
        return;
      }
      if (!barrier) return;
      const kind = routeKind(request.url());
      if (!kind) return;
      let body;
      if (kind !== 'profile') {
        if (request.method() !== 'POST') fail('REQUEST_SCHEMA_INVALID');
        body = request.postDataJSON();
        if (!validContext(body)) fail('CONTEXT_UNVERIFIED');
        if (delivery && !sameContext(body, delivery)) fail('CONTEXT_CHANGED');
        if (search && !sameContext(body, search)) fail('CONTEXT_CHANGED');
      }
      if (kind === 'search') {
        if (body.keywords !== query) return;
        if (!searchPage(request.headers().referer, query) || !searchPage(page.url(), query)) return;
        if (acceptedSearch) fail('SEARCH_AMBIGUOUS');
        acceptedSearch = request;
        search = Object.fromEntries(contextKeys.map(key => [key, body[key]]));
      }
      if (kind === 'cart') {
        delivery = Object.fromEntries(contextKeys.map(key => [key, body[key]]));
      }
      requests.set(request, kind);
      inflight.add(request);
    } catch (error) { stop(error); }
  };
  const onResponse = response => {
    const request = response.request();
    const kind = requests.get(request);
    if (!kind) return;
    const task = (async () => {
      if (kind === 'profile' && [401, 403].includes(response.status())) fail('AUTH_REQUIRED');
      if (!response.ok()) fail('HTTP_FAILED');
      let payload;
      try { payload = await response.json(); } catch { fail('RESPONSE_JSON_INVALID'); }
      if (kind === 'profile') {
        if (payload?.isSuccess !== true || !validId(payload?.data?.entityId) ||
            !Array.isArray(payload?.data?.addressReceiver)) fail('PROFILE_SCHEMA_INVALID');
        const next = { isSuccess: true, data: { entityId: payload.data.entityId,
          addressReceiver: payload.data.addressReceiver.map(address => ({
            addressId: address?.addressId, provinceId: address?.provinceId, wardId: address?.wardId,
          })) } };
        if (profile && JSON.stringify(profile) !== JSON.stringify(next)) fail('CONTEXT_CHANGED');
        profile = next;
      } else if (kind === 'cart') {
        if (payload?.HttpCode !== 200 || payload?.ResultCode !== 0 ||
            !validId(payload?.Value?.ShipAddressId) || !validId(payload?.Value?.StoreId)) fail('CART_SCHEMA_INVALID');
        const next = { ShipAddressId: payload.Value.ShipAddressId, StoreId: payload.Value.StoreId };
        if (cart && JSON.stringify(cart) !== JSON.stringify(next)) fail('CONTEXT_CHANGED');
        cart = next;
      } else {
        products = projectProducts(payload);
      }
      inflight.delete(request);
      const current = check();
      if (current) resolveReady(current);
    })().catch(stop);
    pending.add(task);
    void task.then(() => pending.delete(task));
  };
  const onFailed = request => {
    if (requests.has(request)) stop(new CatalogError('NETWORK_FAILED'));
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onFailed);
  return {
    ready,
    check,
    diagnostics: () => ({ profile_request_seen: [...requests.values()].includes('profile'),
      profile_valid: Boolean(profile), cart_request_seen: [...requests.values()].includes('cart'),
      cart_valid: Boolean(cart), search_request_seen: Boolean(acceptedSearch),
      products_valid: Boolean(products), requests_pending: inflight.size > 0 }),
    products: () => products,
    dispose() {
      clearTimeout(timer);
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onFailed);
      requests.clear();
    },
  };
}

async function main() {
  process.umask(0o077);
  let context;
  let closing;
  let capture;
  let interrupted = false;
  const pending = new Set();
  const close = () => closing ||= context ? context.close() : Promise.resolve();
  const signal = () => { interrupted = true; void close().catch(() => {}); };
  let stage = 'SETUP_FAILED';
  try {
    if (!process.env.DISPLAY) fail('DISPLAY_REQUIRED');
    const { chromium } = await import('playwright');
    const profile = profileDirectory();
    await mkdir(profile, { recursive: true, mode: 0o700 });
    await chmod(profile, 0o700);
    stage = 'LAUNCH_FAILED';
    context = await chromium.launchPersistentContext(profile, {
      headless: false, viewport: { width: 1280, height: 900 },
      ...(process.env.BHX_CHROMIUM_PATH ? { executablePath: process.env.BHX_CHROMIUM_PATH } : {}),
    });
    process.once('SIGINT', signal);
    process.once('SIGTERM', signal);
    const page = await context.newPage();
    const records = [];
    let baseline;
    for (const query of QUERIES) {
      stage = 'NAVIGATION_FAILED';
      capture = queryCapture(page, query, baseline, pending);
      const [navigation, observed] = await Promise.all([
        page.goto('https://www.bachhoaxanh.com/tim-kiem?key=' + encodeURIComponent(query),
          { waitUntil: 'domcontentloaded', timeout: TIMEOUT }),
        capture.ready,
      ]);
      if (!navigation?.ok() || !searchPage(page.url(), query)) fail('NAVIGATION_FAILED');
      baseline ||= observed;
      stage = 'UI_CAPTURE_FAILED';
      const products = [];
      for (const product of capture.products()) {
        const ui = await compareCard(page, product);
        if (!ui.exact_product_path_match) fail('UI_PRODUCT_AMBIGUOUS');
        products.push({ ...product, ui });
      }
      await Promise.all([...pending]);
      if (!capture.check() || interrupted) fail('CAPTURE_INTERRUPTED');
      records.push({ query, profile_cart_match: true, search_cart_match: true, products });
      capture.dispose();
      capture = undefined;
    }
    stage = 'CLOSE_FAILED';
    await close();
    await Promise.all([...pending]);
    if (interrupted) fail('CAPTURE_INTERRUPTED');
    for (const record of records) console.log(JSON.stringify(record));
  } catch (error) {
    console.error('CATALOG_POC_FAILED: ' + (error instanceof CatalogError ? error.message : stage));
    if (error instanceof CatalogError && error.message === 'CAPTURE_TIMEOUT' && capture) {
      console.error(JSON.stringify(capture.diagnostics()));
    }
    process.exitCode = 1;
  } finally {
    capture?.dispose();
    try { await close(); } catch {
      console.error('CATALOG_POC_FAILED: CLOSE_FAILED');
      process.exitCode = 1;
    }
    await Promise.all([...pending]);
    process.removeListener('SIGINT', signal);
    process.removeListener('SIGTERM', signal);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
