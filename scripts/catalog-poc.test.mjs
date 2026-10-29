import assert from 'node:assert/strict';
import { QUERIES, matchContext, projectProducts, queryCapture } from './catalog-poc.mjs';
import { EventEmitter } from 'node:events';

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
for (const malformed of [null, {}, { data: {} }, { data: { products: {} } }, { data: { products: [] } },
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
console.log('PASS: catalog offline context/schema/allowlist/privacy checks; browser not run.');
