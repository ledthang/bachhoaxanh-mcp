import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { profileDirectory } from './profile.mjs';
import { projectCartRead } from './browser.mjs';
import { projectProduct, detailRequestAllowed } from './product.mjs';
import { allowedRequest, contextSnapshot } from '../scripts/cart-poc.mjs';
import { projectProducts, matchContext } from '../scripts/catalog-poc.mjs';
import { validateRefresh } from '../scripts/cart-refresh.mjs';

const SITE = 'https://www.bachhoaxanh.com';
const API = 'https://api.bachhoaxanh.com';
const PREFIX = API + '/gw/cart/api/OrderV2/';
const PROFILE = API + '/gw/bhx-api-identity/api/v1/profile/full-profile';
const SEARCH = API + '/gw/search/v2/DataSearch';
const CONTEXT = ['provinceId', 'districtId', 'wardId', 'storeId'];
const positive = value => Number.isSafeInteger(value) && value > 0;
const identity = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
const fail = () => { throw Error('BHX_MUTATION_UNVERIFIED'); };
const payload = value => ({ HttpCode: 200, ResultCode: 0, Value: value });
const exact = (value, fields) => value && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));

export function validateMutation(name, args) {
  const fields = name === 'bhx_add_to_cart' ? ['product_id', 'quantity', 'max_unit_price_vnd', 'user_authorized'] : name === 'bhx_update_cart_item' ? ['line_id', 'quantity', 'user_authorized'] : name === 'bhx_remove_cart_item' ? ['line_id', 'user_authorized'] : null;
  if (!fields || !exact(args, fields) || args.user_authorized !== true) throw Error('Explicit user_authorized:true and exact arguments required');
  if (name === 'bhx_add_to_cart' ? !positive(args.product_id) || !positive(args.quantity) || !positive(args.max_unit_price_vnd) : !identity(args.line_id) || name === 'bhx_update_cart_item' && !positive(args.quantity)) throw Error('Positive safe integer IDs, quantities and price ceiling required; runtime-owned line only');
}

export function cartLines(cart) {
  projectCartRead(payload(cart));
  if (!identity(cart.CartId)) fail();
  const groups = [...(cart.GroupSOStep2InCart || []), ...(cart.GroupCartOff == null ? [] : [cart.GroupCartOff])];
  const lines = groups.flatMap(group => group.ListCartItemBuy);
  if (new Set(lines.map(line => line.GuildId)).size !== lines.length || lines.some(line => !identity(line.GuildId))) fail();
  const visit = (node, depth = 0) => {
    if (depth > 20) fail();
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (['Items', 'Products', 'CartItems', 'OrderItems', 'OrderDetails', 'ProductList', 'ListProduct', 'Lines', 'ListOfChildProduct', 'ListGift', 'ListAttachProduct'].includes(key) && value != null && (!Array.isArray(value) || value.length)) fail();
      if (key === 'ListCartItemBuy' && !groups.includes(node)) fail();
      visit(value, depth + 1);
    }
  };
  visit(cart);
  return lines;
}

const sorted = lines => [...lines].sort((left, right) => left.GuildId.localeCompare(right.GuildId));
function sameCart(before, after) {
  if (before.CartId !== after.CartId || before.CartTotal.Total !== after.CartTotal.Total || !isDeepStrictEqual(sorted(cartLines(before)), sorted(cartLines(after))) || !isDeepStrictEqual(projectCartRead(payload(before)).items.sort((left, right) => left.line_id.localeCompare(right.line_id)), projectCartRead(payload(after)).items.sort((left, right) => left.line_id.localeCompare(right.line_id)))) fail();
}

export function verifyTransition(before, after, intent) {
  const oldLines = cartLines(before), nextLines = cartLines(after);
  if (before.CartId !== after.CartId) fail();
  const adding = intent.operation === 'Add', removing = intent.operation === 'Remove';
  if (!['Add', 'Remove', 'UpdateCartItem'].includes(intent.operation)) fail();
  const oldTarget = adding ? null : oldLines.find(line => line.GuildId === intent.guid);
  if (adding ? oldLines.some(line => line.Id === intent.productId) : !oldTarget || !isDeepStrictEqual(oldTarget, intent.beforeLine)) fail();
  const targets = nextLines.filter(line => adding ? line.Id === intent.productId : line.GuildId === intent.guid);
  if (targets.length !== (removing ? 0 : 1)) fail();
  const nextTarget = targets[0];
  if (nextTarget && (nextTarget.Id !== intent.productId || nextTarget.QuantityInCart !== intent.quantity || !positive(nextTarget.Price) || nextTarget.Price > intent.ceiling || nextTarget.Total !== nextTarget.Price * intent.quantity || !Number.isSafeInteger(nextTarget.Total) || nextTarget.IsGift || nextTarget.NetUnitValue !== 0)) fail();
  if (oldTarget && nextTarget && (oldTarget.Price !== nextTarget.Price || oldTarget.Id !== nextTarget.Id || ['TypeProduct', 'ChildType', 'IsCombo', 'MainProductRefId', 'NetUnitValue', 'Note'].some(key => !isDeepStrictEqual(oldTarget[key], nextTarget[key])))) fail();
  const untouched = oldLines.filter(line => line !== oldTarget);
  if (!isDeepStrictEqual(sorted(untouched), sorted(nextLines.filter(line => line !== nextTarget)))) fail();
  const oldPublic = projectCartRead(payload(before)).items.filter(line => adding || line.line_id !== intent.guid);
  const nextPublic = projectCartRead(payload(after)).items.filter(line => removing || line.line_id !== nextTarget.GuildId);
  if (!isDeepStrictEqual(sorted(oldPublic.map(line => ({ ...line, GuildId: line.line_id }))), sorted(nextPublic.map(line => ({ ...line, GuildId: line.line_id }))))) fail();
  if (after.CartTotal.Total !== before.CartTotal.Total - (oldTarget?.Total || 0) + (nextTarget?.Total || 0)) fail();
  if (nextTarget && projectCartRead(payload(after)).items.find(line => line.line_id === nextTarget.GuildId)?.inactive) fail();
  return nextTarget;
}

export function mutationBody(intent, context, credentials) {
  if (!intent || !CONTEXT.every(key => Number.isSafeInteger(context?.[key]) && context[key] >= (key === 'districtId' ? 0 : 1)) || !identity(context.cartId) || !positive(intent.productId)) fail();
  const location = Object.fromEntries(CONTEXT.map(key => [key, context[key]]));
  if (intent.operation === 'Add') {
    if (!positive(intent.quantity) || !Number.isSafeInteger(intent.productType) || intent.productType < 0 || !Number.isSafeInteger(intent.scenario) || intent.scenario < 0) fail();
    return { ...location, cartId: context.cartId, productId: intent.productId, quantity: intent.quantity, productType: intent.productType, scenario: intent.scenario, preDateBuy: '', listPromotion: [] };
  }
  if (!identity(intent.guid)) fail();
  if (intent.operation === 'UpdateCartItem' && positive(intent.quantity)) return { ...location, cartId: context.cartId, guid: intent.guid, quantity: intent.quantity, note: '' };
  if (intent.operation !== 'Remove' || typeof credentials?.token !== 'string' || typeof credentials?.us !== 'string') fail();
  return { token: credentials.token, us: credentials.us, ...location, isNewModel: true, data: { cartId: context.cartId, guid: intent.guid, reloadShiping: true, isSubmitOrder: false, productId: intent.productId, wardId: context.wardId } };
}

export function mutationRequestAllowed(request, intent, context, credentials) {
  try {
    if (!intent || request.url !== PREFIX + intent.operation || request.method !== 'POST' || typeof request.raw !== 'string' || request.raw.length > 16384) return false;
    const names = [...request.raw.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(match => JSON.parse(match[1]));
    const expected = mutationBody(intent, context, credentials);
    const expectedNames = [...JSON.stringify(expected).matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(match => JSON.parse(match[1]));
    return names.length === expectedNames.length && names.every(key => names.filter(name => name === key).length === expectedNames.filter(name => name === key).length) && isDeepStrictEqual(JSON.parse(request.raw), expected);
  } catch { return false; }
}

export async function createCartSession({ browserType, profileDirectory: directoryArg, observations = new Map(), expectedBaseline } = {}) {
  const directory = resolve(directoryArg || profileDirectory());
  if (!(await stat(join(directory, 'Default'))).isDirectory()) fail();
  const chromium = browserType || (await import('playwright')).chromium;
  const owned = new Map(), pending = new Set(), reads = new WeakMap();
  let browser, page, profile, delivery, context, snapshot, cart, expectedCart, selected, detail, searchProducts, searchContext, query, headers, credentials, armed;
  let probingRemove = null;
  let fatal = false, serial = Promise.resolve(), generation = 0, readSequence = 0, applied = 0;
  const close = async () => { await browser?.close().catch(() => {}); };
  const drain = async () => { while (pending.size) await Promise.allSettled([...pending]); if (fatal) fail(); };
  const check = value => {
    cartLines(value);
    const current = contextSnapshot(profile, value, delivery);
    if (snapshot && snapshot !== current || context && value.CartId !== context.cartId) fail();
    snapshot = current;
  };
  const wait = async predicate => {
    const deadline = Date.now() + 20000;
    while (!fatal && !predicate() && Date.now() < deadline) await page.waitForTimeout(50);
    await drain();
    if (!predicate()) fail();
  };
  const open = async () => {
    browser = await chromium.launchPersistentContext(directory, { headless: process.env.BHX_HEADED !== '1', offline: true, serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, executablePath: process.env.BHX_CHROMIUM_PATH, timeout: 30000 });
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(20000);
    for (const old of browser.pages()) if (old !== page) await old.close();
    await browser.route('**/*', async route => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        if (fatal || request.frame() !== page.mainFrame()) { await route.abort(); return; }
        if (probingRemove && request.url() === PREFIX + 'Remove') {
          const body = request.postDataJSON();
          const candidate = { token: body?.token, us: body?.us };
          if (!mutationRequestAllowed({ url: request.url(), method: request.method(), raw: request.postData() }, probingRemove, context, candidate)) fail();
          credentials = candidate; probingRemove = null; await route.abort(); return;
        }
        if (url.origin === API && url.pathname === '/gw/cart/api/OrderV2/GetRecommandStores') { await route.abort(); return; }
        if (url.origin === API && url.pathname.startsWith('/gw/cart/api/OrderV2/') && !['get', 'getAfter'].includes(url.pathname.slice('/gw/cart/api/OrderV2/'.length))) {
          if (!armed || page.url() !== SITE + '/gio-hang' || request.isNavigationRequest() || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers()['content-type'] || '') || !mutationRequestAllowed({ url: request.url(), method: request.method(), raw: request.postData() }, armed.intent, context, credentials)) fail();
          sameCart(armed.before, cart); check(cart);
          armed.sent = true; armed = null; generation++;
          await route.continue(); return;
        }
        let allow = false;
        if (request.url() === PREFIX + 'get') {
          const body = request.postDataJSON();
          if (request.method() !== 'POST' || request.isNavigationRequest() || !CONTEXT.every(key => Number.isSafeInteger(body?.[key]) && body[key] >= (key === 'districtId' ? 0 : 1) && (!context || body[key] === context[key]))) fail();
          reads.set(request, { generation, sequence: ++readSequence, delivery: Object.fromEntries(CONTEXT.map(key => [key, body[key]])) });
          headers = request.headers(); allow = true;
        } else if (request.url() === PREFIX + 'getAfter') {
          if (request.method() !== 'POST' || request.isNavigationRequest() || !validateRefresh(request.postData(), context)) fail();
          const body = request.postDataJSON(); credentials = { token: body.token, us: body.us };
          reads.set(request, { generation, sequence: ++readSequence, delivery }); allow = true;
        } else if (request.isNavigationRequest()) {
          allow = request.method() === 'GET' && [SITE + '/tim-kiem?key=' + encodeURIComponent(query), SITE + '/gio-hang', ...(selected ? [SITE + selected.path] : [])].includes(request.url());
        } else if (url.pathname === '/gw/Product/GetProductDetail') {
          allow = detailRequestAllowed(request.url(), request.method(), selected, delivery);
        } else if (request.url() === SEARCH) {
          const body = request.postDataJSON();
          allow = request.method() === 'POST' && body?.keywords === query;
          if (allow) reads.set(request, { generation, search: true, delivery: Object.fromEntries(CONTEXT.map(key => [key, body[key]])) });
        } else if (request.url() === API + '/gw/search/GetSuggestSearchNew') {
          allow = request.method() === 'POST' && request.postDataJSON()?.keyword === query;
        } else if (request.url() === API + '/gw/search/v2/FilterSearch') {
          allow = request.method() === 'POST' && request.postDataJSON()?.keywords === query;
        } else if (url.origin === API && ['/gw/BigBang/GetProductsPromoteCartV2ByCate', '/gw/cart/api/VoucherCoupon/v3/GetListVoucherCoupon'].includes(url.pathname)) {
          await route.abort(); return;
        } else if (request.url() === API + '/gw/User/GetRankCustomerNew') {
          await route.abort(); return; // Optional loyalty read; never needed for cart authorization.
        } else if (request.url() === API + '/gw/LocationV3/GetFull') allow = request.method() === 'GET';
        else allow = allowedRequest(request.url(), request.method(), false, request.resourceType(), '/gio-hang');
        if (!allow) {
          if (request.isNavigationRequest()) { fatal = true; if (process.env.BHX_DIAGNOSTICS === '1') console.error(JSON.stringify({ blocked_path: url.pathname })); }
          await route.abort(); return;
        }
        await route.continue();
      } catch { fatal = true; if (process.env.BHX_DIAGNOSTICS === '1') console.error(JSON.stringify({ mutation_guard_path: new URL(request.url()).pathname })); await route.abort().catch(() => {}); }
    });
    page.on('response', response => {
      const request = response.request(), url = response.url(), read = reads.get(request);
      if (url !== PROFILE && !read && !(selected && new URL(url).pathname === '/gw/Product/GetProductDetail')) return;
      const task = (async () => {
        if (!response.ok()) fail();
        const body = await response.json();
        if (read && read.generation !== generation) return;
        if (url === PROFILE) { if (snapshot && contextSnapshot(body, cart, delivery) !== snapshot) fail(); profile = body; }
        else if (read?.search) {
          searchContext = read.delivery; searchProducts = projectProducts(body);
        } else if (read) {
          if (read.sequence < applied) return;
          if (body?.HttpCode !== 200 || body?.ResultCode !== 0) fail();
          if (delivery && !isDeepStrictEqual(delivery, read.delivery)) fail();
          delivery = read.delivery; cartLines(body.Value);
          cart = body.Value; applied = read.sequence;
          if (snapshot) check(cart);
        } else detail = projectProduct(body, selected.id);
      })().catch(() => { fatal = true; }).finally(() => pending.delete(task));
      pending.add(task);
    });
    await browser.setOffline(false);
    await page.goto(SITE + '/tim-kiem?key=' + encodeURIComponent(query), { waitUntil: 'domcontentloaded' });
    await wait(() => profile && cart && delivery);
    context = { ...delivery, cartId: cart.CartId }; check(cart);
    if (expectedBaseline && (!isDeepStrictEqual(projectCartRead(payload(cart)), expectedBaseline.cart) || ['store_id', 'province_id', 'ward_id'].some((key, index) => expectedBaseline.context?.[key] !== [context.storeId, context.provinceId, context.wardId][index]) || expectedBaseline.context?.address_id !== String(cart.ShipAddressId))) fail();
    expectedCart = structuredClone(cart);
  };
  const refresh = async () => {
    const before = applied;
    await page.goto(SITE + '/gio-hang', { waitUntil: 'domcontentloaded' });
    if (applied === before) await page.reload({ waitUntil: 'domcontentloaded' });
    await wait(() => applied > before);
    await page.waitForTimeout(500); await drain(); check(cart);
  };
  const publicCart = () => {
    const value = { address_id: String(cart.ShipAddressId), store_id: context.storeId, province_id: context.provinceId, ward_id: context.wardId, verified: true, source: 'authenticated-browser' };
    value.delivery_context_id = createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
    return { ...projectCartRead(payload(cart)), context: value, observed_at: new Date().toISOString() };
  };
  const run = callback => {
    const result = serial.then(async () => {
      if (fatal) fail();
      const timer = setTimeout(() => { fatal = true; void close(); }, 60000);
      try { return await callback(); }
      catch (error) { fatal = true; if (process.env.BHX_DIAGNOSTICS === '1') console.error(JSON.stringify({ mutation_failure_type: error?.name, mutation_failure_frame: error?.stack?.split('\n')[2]?.replace(/.*cart-mutations.mjs/, 'cart-mutations.mjs'), mutation_failure_code: String(error?.message).startsWith('BHX_') ? error.message : 'runtime-error' })); throw Error('BHX_MUTATION_UNVERIFIED: cleanup_required; stop, inspect cart, no retry or automatic cleanup'); }
      finally { clearTimeout(timer); armed = null; if (fatal) await close(); }
    });
    serial = result.catch(() => {}); return result;
  };
  return {
    close,
    readCart: () => run(async () => { if (!browser) fail(); await refresh(); sameCart(expectedCart, cart); return publicCart(); }),
    mutate: (name, args) => run(async () => {
      validateMutation(name, args);
      const observation = name === 'bhx_add_to_cart' ? observations.get(args.product_id) : null;
      if (!browser) {
        if (!observation) fail();
        query = observation.query; await open();
      }
      await refresh(); sameCart(expectedCart, cart);
      let intent, handle;
      if (name === 'bhx_add_to_cart') {
        if (!observation || Date.now() - observation.at > 300000 || observation.context?.verified !== true || observation.context.address_id !== String(cart.ShipAddressId) || observation.context.store_id !== context.storeId || observation.context.province_id !== context.provinceId || observation.context.ward_id !== context.wardId || cartLines(cart).some(line => line.Id === args.product_id)) fail();
        query = observation.query; selected = null; searchProducts = null; detail = null;
        await page.goto(SITE + '/tim-kiem?key=' + encodeURIComponent(query), { waitUntil: 'domcontentloaded' });
        await wait(() => searchProducts);
        if (!matchContext(profile, cart, delivery, searchContext).search_cart_match) fail();
        const matches = searchProducts.filter(product => product.id === args.product_id);
        if (matches.length !== 1) fail(); selected = matches[0];
        if (!/^\/[a-z0-9-]+\/[a-z0-9-]+$/.test(selected.path)) fail();
        await page.goto(SITE + selected.path, { waitUntil: 'domcontentloaded' });
        await wait(() => detail);
        const heading = page.locator('div.sticky h1');
        await heading.waitFor({ state: 'visible', timeout: 10000 });
        if (await heading.count() !== 1 || (await heading.innerText()).trim() !== selected.name || detail.variant === null || detail.scenario === null || detail.prices.some(price => price.can_buy !== true || !positive(price.price_vnd) || price.list_price_vnd > args.max_unit_price_vnd) || selected.prices.some(price => price.can_buy !== true) || !Number.isSafeInteger(args.quantity * args.max_unit_price_vnd)) fail();
        intent = { operation: 'Add', productId: args.product_id, quantity: args.quantity, productType: detail.variant, scenario: detail.scenario, ceiling: args.max_unit_price_vnd };
      } else {
        const ownership = owned.get(args.line_id); if (!ownership) fail();
        const current = cartLines(cart).find(line => line.GuildId === ownership.line.GuildId);
        if (!isDeepStrictEqual(current, ownership.line)) fail();
        handle = args.line_id;
        intent = { operation: name === 'bhx_remove_cart_item' ? 'Remove' : 'UpdateCartItem', productId: current.Id, guid: current.GuildId, quantity: args.quantity, ceiling: ownership.ceiling, beforeLine: current };
        if (name === 'bhx_update_cart_item' && (!Number.isSafeInteger(args.quantity * current.Price) || current.QuantityInCart === args.quantity)) fail();
      }
      await refresh(); sameCart(expectedCart, cart);
      if (intent.operation === 'Remove' && (!credentials || typeof credentials.token !== 'string' || typeof credentials.us !== 'string')) {
        probingRemove = intent;
        const row = page.locator(`div[data-product="${intent.productId}"][data-code="${intent.guid}"]`);
        if (await row.count() !== 1 || await row.locator('img[alt="close-icon"]').count() !== 1) fail();
        await row.locator('img[alt="close-icon"]').dispatchEvent('click');
        await page.waitForTimeout(500);
        if (probingRemove) {
          const confirm = page.locator('button:visible').filter({ hasText: /^ĐỒNG Ý$/i });
          if (await confirm.count() === 1) await confirm.click();
          await page.waitForTimeout(700);
        }
        if (probingRemove) {
          const remove = page.locator('button:visible').filter({ hasText: /^Xóa$/ });
          if (await remove.count() !== 1) fail();
          await remove.click();
        }
        await wait(() => !probingRemove);
        await refresh(); sameCart(expectedCart, cart);
      }
      const before = structuredClone(cart), body = mutationBody(intent, context, credentials);
      const permittedHeaders = Object.fromEntries(Object.entries(headers || {}).filter(([key]) => !['host', 'content-length', 'cookie', 'origin', 'referer', 'connection', 'accept-encoding'].includes(key) && !key.startsWith('sec-')));
      const ticket = { intent, before, sent: false }; armed = ticket;
      const acknowledgement = await page.evaluate(async ({ url, body, headers }) => {
        const response = await fetch(url, { method: 'POST', credentials: 'include', redirect: 'error', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) throw Error('MUTATION_HTTP');
        return response.json();
      }, { url: PREFIX + intent.operation, body, headers: permittedHeaders });
      if (process.env.BHX_DIAGNOSTICS === '1') console.error(JSON.stringify({ mutation_operation: intent.operation, acknowledgement_code: acknowledgement?.ResultCode, acknowledgement_value_keys: Object.keys(acknowledgement?.Value || {}), before_count: cartLines(before).length }));
      if (!ticket.sent || acknowledgement?.HttpCode !== 200 || acknowledgement?.ResultCode !== 0 || intent.operation === 'Add' && acknowledgement.Value?.CartId !== context.cartId) fail();
      await refresh();
      const next = verifyTransition(before, cart, intent);
      if (next) owned.set(handle || randomUUID(), { line: structuredClone(next), ceiling: intent.ceiling });
      else owned.delete(handle);
      expectedCart = structuredClone(cart);
      return { verified: true, operation: name, items: [...owned].map(([lineId, entry]) => ({ line_id: lineId, product_id: entry.line.Id, quantity: entry.line.QuantityInCart, unit_price_vnd: entry.line.Price, total_vnd: entry.line.Total })), observed_at: new Date().toISOString() };
    }),
  };
}
