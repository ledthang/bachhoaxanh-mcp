import assert from 'node:assert/strict';
import { QUERIES, matchContext, projectProducts, queryCapture } from './catalog-poc.mjs';
import { EventEmitter } from 'node:events';
import { mock } from 'node:test';

const page = new EventEmitter();
let pageUrl = 'https://www.bachhoaxanh.com/tim-kiem?key=' + encodeURIComponent('ức gà');
page.url = () => pageUrl;
const capture = queryCapture(page, 'ức gà', undefined, new Set());
try {
  assert.equal(capture.check(), false);
  pageUrl = 'https://www.bachhoaxanh.com/tim-kiem?key=other';
  assert.throws(() => capture.check(), /NAVIGATION_CHANGED/);
} finally { capture.dispose(); }

const profile = { isSuccess: true, data: { entityId: 1,
  addressReceiver: [{ addressId: '2', provinceId: 3, wardId: 4 }], secret: 'PRIVATE_ACCOUNT' } };
const cart = { ShipAddressId: 2, StoreId: 5, secret: 'PRIVATE_CART' };
const delivery = { provinceId: 3, wardId: 4, storeId: 5 };
const matches = (owner = profile, basket = cart, location = delivery, search = delivery) =>
  matchContext(owner, basket, location, search);
assert.deepEqual(matches(), { profile_cart_match: true, search_cart_match: true });
assert.deepEqual(matches(null, null, null, null), { profile_cart_match: false, search_cart_match: false });
assert.deepEqual(matchContext(), { profile_cart_match: false, search_cart_match: false });
for (const invalid of [undefined, null, 0, -1, '', 'undefined', '02', 1.5, NaN, Infinity, {}, 9007199254740992]) {
  assert.equal(matches(profile, { ...cart, ShipAddressId: invalid }).profile_cart_match, false);
  assert.equal(matches(profile, { ...cart, StoreId: invalid }).search_cart_match, false);
  assert.equal(matches({ ...profile, data: { ...profile.data, entityId: invalid } }).profile_cart_match, false);
  for (const key of Object.keys(delivery)) {
    assert.equal(matches(profile, cart, { ...delivery, [key]: invalid }).profile_cart_match, false);
    assert.equal(matches(profile, cart, delivery, { ...delivery, [key]: invalid }).search_cart_match, false);
    assert.equal(matches(profile, cart, delivery, { ...delivery, [key]: 99 }).search_cart_match, false);
  }
}
assert.equal(matches(profile, { ...cart, StoreId: 99 }).profile_cart_match, false);
for (const key of ['addressId', 'provinceId', 'wardId']) {
  const changed = structuredClone(profile);
  changed.data.addressReceiver[0][key] = 99;
  assert.equal(matches(changed).profile_cart_match, false);
}
const product = { id: 10, fullName: 'Sữa tươi', url: '/sua-tuoi/sua-hop', unit: 'hộp',
  productPrices: [{ price: 10000, sysPrice: 12000, isCanBuy: true, warehouseId: 5,
    stock: 777, secret: 'PRIVATE_PRICE' }], secret: 'PRIVATE_PRODUCT', account: profile };
const payload = { data: { products: [product], account: profile }, cookies: 'PRIVATE_COOKIE' };
const projected = projectProducts(payload);
assert.deepEqual(projected, [{ id: 10, name: 'Sữa tươi', path: '/sua-tuoi/sua-hop', unit: 'hộp',
  prices: [{ price: 10000, list_price: 12000, can_buy: true }] }]);
assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|account|cookies|warehouse|stock|entityId|ShipAddressId/);
assert.deepEqual(projectProducts({data:{products:[]}}),[]);
assert.equal(projectProducts({data:{products:Array.from({length:10},(_,index)=>({...product,id:index+1}))}}).length,10);
for (const malformed of [null, {}, { data: {} }, { data: { products: {} } },
  { data: { products: [null] } }, { data: { products: [product, product, product, {}] } }]) {
  assert.throws(() => projectProducts(malformed), /^Error: PRODUCTS_SCHEMA_INVALID$/);
}
for (const changes of [{ id: undefined }, { unit: null }, { fullName: 'https://private/?token=secret' },
  { url: '//private/path' }, { url: '/sua/sua?token=secret' }, { url: '/sua/../secret' },
  { url: '/sua/"secret' }, { productPrices: [] }, { productPrices: [{ price: NaN }] },
  { productPrices: [{ price: 1, sysPrice: 2, isCanBuy: 'true' }] }]) {
  assert.throws(() => projectProducts({ data: { products: [{ ...product, ...changes }] } }));
}
assert.equal(QUERIES.length, 5);
const campaign = { startTime: '2026-10-30T08:00:00+07:00', dueTime: '2026-10-30T10:00:00+07:00',
  remainingQuantity: 650, maxQuantityOrder: 10, storeIdInit: 'PRIVATE_STORE',
  productPrice: { price: 11920.7407407407, sysPrice: 14000, isCanBuy: true, quantity: 200 } };
const campaignProduct = { ...product, scenario: 1, isSpecialOffer: false,
  productPrices: [{ price: 12340.7407407407, sysPrice: 14000, isCanBuy: true, quantity: 200 }],
  lstCampaingInfo: [campaign] };
const campaignProjection = (changes = {}, now = '2026-10-30T09:00:00+07:00') =>
  projectProducts({ data: { products: [{ ...campaignProduct, ...changes }] } }, { now })[0];
const activeCampaign = campaignProjection();
assert.equal(activeCampaign.prices[0].price, 12340.7407407407);
assert.equal(activeCampaign.display_price, 11921);
assert.deepEqual(activeCampaign.promotion, { status: 'active', start_time: campaign.startTime,
  due_time: campaign.dueTime, remaining_quantity: 650, maximum_quantity: 10 });
assert.equal(activeCampaign.price_status, 'display-only-cart-payable-unverified');
assert.doesNotMatch(JSON.stringify(activeCampaign), /PRIVATE|storeId|quantity":200|crmProgram|timeLine/);
for (const now of ['2026-10-30T07:59:59+07:00', '2026-10-30T10:00:01+07:00']) {
  assert.equal(campaignProjection({}, now).display_price, 12341);
  assert.equal(campaignProjection({}, now).promotion.status, 'inactive');
}
for (const now of [campaign.startTime, campaign.dueTime]) assert.equal(campaignProjection({}, now).display_price, 11921);
assert.equal(campaignProjection({ lstCampaingInfo: [{ ...campaign, remainingQuantity: 0 }] }).display_price, 12341);
for (const changes of [{ isSpecialOffer: true }, { scenario: 2 }, { lstCampaingInfo: {} },
  { lstCampaingInfo: [campaign, campaign] }, ...[
    { startTime: 'bad' }, { dueTime: campaign.startTime }, { remainingQuantity: -1 },
    { remainingQuantity: '650' }, { maxQuantityOrder: 0 }, { productPrice: null },
    { productPrice: { ...campaign.productPrice, price: NaN } },
  ].map(change => ({ lstCampaingInfo: [{ ...campaign, ...change }] }))]) {
  assert.equal(campaignProjection(changes).promotion.status,'unknown');
  assert.equal(campaignProjection(changes).display_price,undefined);
}
assert.equal(campaignProjection({}, 'invalid').promotion.status,'unknown');
mock.timers.enable({ apis: ['setTimeout'] });
try {
  for (const scenario of ['missing', 'cart-only', 'profile-only', 'cart-401', '401', '403', '500', 'schema', 'rejection-unknown', 'json', 'network', 'foreign', 'before-navigation']) {
    const observedPage = new EventEmitter();
    const frame = {};
    observedPage.mainFrame = () => frame;
    observedPage.url = () => 'https://www.bachhoaxanh.com/tim-kiem?key=' + encodeURIComponent('ức gà');
    const pending = new Set();
    const observed = queryCapture(observedPage, 'ức gà', undefined, pending);
    try {
      if (scenario !== 'before-navigation') observedPage.emit('request', {
        frame: () => frame, isNavigationRequest: () => true, url: observedPage.url,
      });
      const request = { frame: () => scenario === 'foreign' ? {} : frame,
        isNavigationRequest: () => false,
        url: () => 'https://api.bachhoaxanh.com/' + (scenario.startsWith('cart-') ? 'OrderV2/get' : 'profile/full-profile'),
        method: () => 'POST', postDataJSON: () => delivery };
      if (scenario !== 'missing') {
        observedPage.emit('request', request);
        if (scenario === 'network') observedPage.emit('requestfailed', request);
        else observedPage.emit('response', { request: () => request,
          status: () => scenario === 'cart-401' ? 401 : Number(scenario) || 200,
          ok: () => !['401', '403', '500', 'cart-401'].includes(scenario),
          json: async () => {
            if (scenario === 'json') throw new Error('PRIVATE_TOKEN');
            return scenario === 'cart-only' ? { HttpCode: 200, ResultCode: 0, Value: cart } :
              scenario === 'profile-only' ? profile :
              scenario === 'rejection-unknown' ? { isSuccess: false, message: 'PRIVATE_TOKEN' } : {};
          } });
      }
      await Promise.all([...pending]);
      mock.timers.tick(30000);
      const expected = ['401', '403'].includes(scenario) ? 'AUTH_REQUIRED' :
        ['500', 'cart-401'].includes(scenario) ? 'HTTP_FAILED' : scenario === 'network' ? 'NETWORK_FAILED' :
        scenario === 'json' ? 'RESPONSE_JSON_INVALID' :
        ['schema', 'rejection-unknown'].includes(scenario) ? 'PROFILE_SCHEMA_INVALID' : 'CAPTURE_TIMEOUT';
      await assert.rejects(observed.ready, { message: expected });
      assert.throws(observed.check, { message: expected });
      const diagnostics = observed.diagnostics();
      assert.ok(Object.values(diagnostics).every(value => typeof value === 'boolean'));
      assert.equal(diagnostics.cart_valid, scenario === 'cart-only');
      assert.equal(diagnostics.profile_valid, scenario === 'profile-only');
      assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE|token|address|entityId/i);
    } finally { observed.dispose(); }
    for (const event of ['request', 'response', 'requestfailed']) assert.equal(observedPage.listenerCount(event), 0);
  }
} finally { mock.timers.reset(); }
console.log('PASS: catalog offline context/schema/allowlist/privacy checks; browser not run.');
