import assert from 'node:assert/strict';
import { validateMutation, cartLines, verifyTransition, mutationBody, mutationRequestAllowed, createCartSession } from '../src/cart-mutations.mjs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const context = { provinceId: 3, districtId: 0, wardId: 4, storeId: 5, cartId: 'test-cart' };
const line = (product, guid, quantity = 1) => ({ Id: product, GuildId: guid, Name: 'Test', QuantityInCart: quantity, Price: 4000, Total: quantity * 4000, NetUnitValue: 0 });
const cart = lines => ({ CartId: context.cartId, TotalItemShow: lines.length, GroupSOStep2InCart: [{ ListCartItemBuy: lines }], CartTotal: { Total: lines.reduce((total, item) => total + item.Total, 0) } });
const baseline = line(10, 'baseline'), first = line(20, 'first'), second = line(30, 'second');
for (const quantity of [1, 2, 7, Number.MAX_SAFE_INTEGER]) {
  validateMutation('bhx_add_to_cart', { product_id: 20, quantity, max_unit_price_vnd: 5000, user_authorized: true });
  validateMutation('bhx_update_cart_item', { line_id: 'first', quantity, user_authorized: true });
}
for (const quantity of [0, -1, 1.5, Infinity, '2', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => validateMutation('bhx_add_to_cart', { product_id: 20, quantity, max_unit_price_vnd: 5000, user_authorized: true }));
assert.throws(() => validateMutation('bhx_remove_cart_item', { line_id: 'first', user_authorized: false }));
const target = { operation: 'Add', productId: 30, quantity: 1, productType: 1, scenario: 0, ceiling: 5000 };
assert.equal(verifyTransition(cart([baseline, first]), cart([baseline, first, second]), target).GuildId, 'second');
assert.throws(() => verifyTransition(cart([baseline, first]), cart([line(10, 'baseline', 2), first, second]), target));
assert.throws(() => verifyTransition(cart([baseline, first]), cart([baseline, second]), target));
assert.throws(() => verifyTransition(cart([baseline, second]), cart([baseline, second]), target));
assert.throws(() => cartLines(cart([baseline, baseline])));
assert.throws(() => cartLines({ ...cart([baseline]), Items: [first] }));
assert.throws(() => cartLines(cart([{ ...baseline, ListGift: [first] }])));
const update = { ...target, operation: 'UpdateCartItem', guid: 'second', quantity: 7, beforeLine: second };
verifyTransition(cart([baseline, first, second]), cart([baseline, first, line(30, 'second', 7)]), update);
assert.throws(() => verifyTransition(cart([baseline, first, second]), cart([baseline, line(20, 'first', 2), line(30, 'second', 7)]), update));
verifyTransition(cart([baseline, first, second]), cart([baseline, first]), { ...update, operation: 'Remove' });
for (const operation of ['Add', 'UpdateCartItem', 'Remove']) {
  const intent = { ...update, operation }, credentials = { token: '', us: '' };
  const body = mutationBody(intent, context, credentials);
  const request = { url: `https://api.bachhoaxanh.com/gw/cart/api/OrderV2/${operation}`, method: 'POST', raw: JSON.stringify(body) };
  assert.equal(mutationRequestAllowed(request, intent, context, credentials), true);
  for (const changed of [{ ...body, quantity: 99 }, { ...body, storeId: 99 }, { ...body, extra: true }]) assert.equal(mutationRequestAllowed({ ...request, raw: JSON.stringify(changed) }, intent, context, credentials), false);
  for (const url of [request.url + '?x=1', request.url.replace(operation, 'SubmitOrder')]) assert.equal(mutationRequestAllowed({ ...request, url }, intent, context, credentials), false);
  assert.equal(mutationRequestAllowed({ ...request, raw: request.raw.replace('"storeId":5', '"storeId":5,"storeId":5') }, intent, context, credentials), false);
}
async function fixtureSession() {
  const directory = await mkdtemp(join(tmpdir(), 'bhx-cart-test-'));
  await mkdir(join(directory, 'Default'));
  const site = 'https://www.bachhoaxanh.com', api = 'https://api.bachhoaxanh.com';
  const prefix = api + '/gw/cart/api/OrderV2/';
  let current = { ...cart([baseline]), ShipAddressId: 6, StoreId: 5 }, routeHandler, responseHandler, currentURL;
  let mutationCount = 0, closed = false, inject;
  const frame = {};
  const envelope = value => ({ HttpCode: 200, ResultCode: 0, Value: structuredClone(value) });
  const request = (url, body, method = 'POST') => ({ url: () => url, method: () => method, frame: () => frame, isNavigationRequest: () => false, headers: () => ({ 'content-type': 'application/json' }), postData: () => JSON.stringify(body), postDataJSON: () => body, resourceType: () => 'fetch' });
  const dispatch = async (url, body, result, method) => {
    const item = request(url, body, method);
    let continued = false;
    await routeHandler({ request: () => item, continue: async () => { continued = true; }, abort: async () => {} });
    if (!continued) throw Error('request blocked');
    responseHandler({ request: () => item, url: () => url, ok: () => true, json: async () => result });
    await Promise.resolve(); await Promise.resolve();
  };
  const navigate = async url => {
    currentURL = url;
    if (inject) { inject(current); inject = null; }
    await dispatch(api + '/gw/bhx-api-identity/api/v1/profile/full-profile', null, { isSuccess: true, data: { entityId: 7, addressReceiver: [{ addressId: 6, provinceId: 3, wardId: 4 }] } }, 'GET');
    await dispatch(prefix + 'get', { provinceId: 3, districtId: 0, wardId: 4, storeId: 5 }, envelope(current));
    if (url === site + '/gio-hang') await dispatch(prefix + 'getAfter', { token: '', us: '', provinceId: 3, districtId: 0, wardId: 4, storeId: 5, isNewModel: true, data: { cartId: 'test-cart', infoApp: 'webnew', wardId: 4 } }, envelope(current));
    if (url.includes('/tim-kiem')) await dispatch(api + '/gw/search/v2/DataSearch', { keywords: 'test', ...context }, { data: { products: [20, 30].map(product => ({ id: product, name: 'Test', unit: 'bag', url: '/test/product-' + product, productPrices: [{ price: 4000, sysPrice: 4000, isCanBuy: true }] })) } });
    if (url.includes('/test/product-')) {
      const product = Number(url.split('-').at(-1));
      await dispatch(api + '/gw/Product/GetProductDetail?productId=' + product + '&provinceId=3&wardId=4&storeId=5', null, { data: { id: product, boxBuys: [{ id: product, type: 1, scenario: 0, productPrices: [{ price: 4000, sysPrice: 4000, isCanBuy: true }] }] } }, 'GET');
    }
  };
  const page = {
    mainFrame: () => frame, url: () => currentURL, setDefaultNavigationTimeout() {},
    on: (name, handler) => { responseHandler = handler; }, goto: navigate, reload: async () => navigate(currentURL), waitForTimeout: async () => {},
    locator: () => ({ waitFor: async () => {}, count: async () => 1, innerText: async () => 'Test' }),
    evaluate: async (callback, { url, body }) => {
      let continued = false;
      await routeHandler({ request: () => request(url, body), continue: async () => { continued = true; }, abort: async () => {} });
      if (!continued) throw Error('mutation blocked');
      mutationCount++;
      const operation = url.slice(prefix.length), lines = cartLines(current);
      if (operation === 'Add') lines.push(line(body.productId, 'new-' + body.productId, body.quantity));
      else if (operation === 'Remove') lines.splice(lines.findIndex(item => item.GuildId === body.data.guid), 1);
      else { const target = lines.find(item => item.GuildId === body.guid); target.QuantityInCart = body.quantity; target.Total = target.Price * body.quantity; }
      current = { ...current, ...cart(lines) };
      return envelope(current);
    },
  };
  const browser = { newPage: async () => page, pages: () => [page], route: async (pattern, handler) => { routeHandler = handler; }, setOffline: async () => {}, close: async () => { closed = true; } };
  const observations = new Map([20, 30].map(product => [product, { query: 'test', at: Date.now(), context: { verified: true, address_id: '6', store_id: 5, province_id: 3, ward_id: 4 } }]));
  const session = await createCartSession({ browserType: { launchPersistentContext: async () => browser }, profileDirectory: directory, observations });
  return { session, count: () => mutationCount, closed: () => closed, inject: callback => { inject = callback; }, dispose: async () => { await session.close(); await rm(directory, { recursive: true }); } };
}
const fixture = await fixtureSession();
try {
  const add = product_id => fixture.session.mutate('bhx_add_to_cart', { product_id, quantity: 1, max_unit_price_vnd: 5000, user_authorized: true });
  const firstResult = await add(20), firstHandle = firstResult.items[0].line_id;
  const secondResult = await add(30), secondHandle = secondResult.items.find(item => item.product_id === 30).line_id;
  assert.equal(secondResult.items.length, 2);
  await fixture.session.mutate('bhx_update_cart_item', { line_id: secondHandle, quantity: 7, user_authorized: true });
  let state = await fixture.session.readCart();
  assert.deepEqual(state.items.find(item => item.product_id === 20), { product_id: 20, line_id: 'new-20', name: 'Test', quantity: 1, unit_price: 4000, total: 4000, inactive: false });
  await fixture.session.mutate('bhx_remove_cart_item', { line_id: secondHandle, user_authorized: true });
  await fixture.session.mutate('bhx_remove_cart_item', { line_id: firstHandle, user_authorized: true });
  state = await fixture.session.readCart();
  assert.equal(state.items.length, 1); assert.equal(state.items[0].product_id, 10); assert.equal(fixture.count(), 5);
} finally { await fixture.dispose(); }
for (const unsafe of ['unknown-line', 'concurrent-change', 'baseline-product']) {
  const fixture = await fixtureSession();
  try {
    await fixture.session.mutate('bhx_add_to_cart', { product_id: 20, quantity: 3, max_unit_price_vnd: 5000, user_authorized: true });
    if (unsafe === 'concurrent-change') fixture.inject(value => { value.GroupSOStep2InCart[0].ListCartItemBuy[0].Name = 'Changed'; });
    await assert.rejects(() => unsafe === 'unknown-line' ? fixture.session.mutate('bhx_remove_cart_item', { line_id: 'baseline', user_authorized: true }) : fixture.session.mutate('bhx_add_to_cart', { product_id: unsafe === 'baseline-product' ? 10 : 30, quantity: 1, max_unit_price_vnd: 5000, user_authorized: true }));
    assert.equal(fixture.count(), 1); assert.equal(fixture.closed(), true);
  } finally { await fixture.dispose(); }
}
console.log('PASS: generalized validation, exact requests, multi-owned lifecycle, unrelated-line preservation and concurrent-change rejection; no browser/network.');
