import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allowedRequest, blockedKnownRequest, projectCart, contextSnapshot, productUI, safeDiagnostic } from './cart-poc.mjs';

assert.deepEqual(safeDiagnostic('PRODUCT_UI', Object.assign(new Error('https://private.example/token'),
  { name: 'TimeoutError', stack: 'PRIVATE', code: 'PRIVATE' })),
{ phase: 'PRODUCT_UI', error_name: 'TimeoutError' });
assert.deepEqual(safeDiagnostic('OUTPUT_OPEN', { name: 'Error', code: 'EEXIST', path: 'PRIVATE' }),
  { phase: 'OUTPUT_OPEN', error_name: 'Error', error_code: 'EEXIST' });
assert.deepEqual(safeDiagnostic('https://private.example', { name: 'PRIVATE', code: 'PRIVATE' }),
  { phase: 'UNKNOWN', error_name: 'OTHER' });

const warmup = 'https://www.bachhoaxanh.com/tim-kiem?key=' + encodeURIComponent('cải ngọt');
assert.equal(allowedRequest(warmup, 'GET', true, 'document'), true);
for (const url of [warmup + '&key=x', warmup + '&extra=1', warmup + '#x',
  warmup.replace('key=', 'other='), 'https://www.bachhoaxanh.com/tim-kiem?key=x',
  warmup.replace('www.bachhoaxanh.com', 'other.example')]) {
  assert.equal(allowedRequest(url, 'GET', true, 'document'), false);
}
assert.equal(allowedRequest(warmup, 'POST', true, 'document'), false);
const search = 'https://api.bachhoaxanh.com/gw/search/v2/DataSearch';
assert.equal(allowedRequest(search, 'POST', false, 'fetch'), true);
for (const method of ['GET', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']) {
  assert.equal(allowedRequest(search, method, false, 'fetch'), false);
}
for (const url of [search + '?key=x', search + '/extra', search.replace('DataSearch', 'Other'),
  search.replace('api.bachhoaxanh.com', 'other.example')]) {
  assert.equal(allowedRequest(url, 'POST', false, 'fetch'), false);
}
assert.deepEqual(blockedKnownRequest(search + '?private=x', 'OPTIONS'),
  { route: '/gw/search/v2/DataSearch', method: 'OPTIONS' });

const api = 'https://api.bachhoaxanh.com/gw/cart/api/OrderV2/';
assert.equal(allowedRequest(api + 'get', 'POST', false, 'fetch'), true);
for (const name of ['add', 'update', 'remove', 'CheckValidateCart', 'checkout', 'payment']) {
  for (const method of ['POST', 'GET']) assert.equal(allowedRequest(api + name, method, false, 'fetch'), false);
}
assert.equal(allowedRequest(api + 'get?token=PRIVATE', 'POST', false, 'fetch'), false);
const detail = 'https://api.bachhoaxanh.com/gw/Product/GetProductDetail';
assert.equal(allowedRequest(detail + '?productId=335195&provinceId=3&wardId=4&storeId=5&districtId=0', 'GET', false, 'fetch'), true);
for (const query of ['', '?productId=1', '?productId=335195&token=PRIVATE', '?productId=335195&storeId=-1',
  '?productId=335195&wardId=1e3', '?productId=335195&storeId=9007199254740992',
  '?productId=335195&productId=335195', '?productId=335195&provinceId=0']) {
  assert.equal(allowedRequest(detail + query, 'GET', false, 'fetch'), false);
}
assert.equal(allowedRequest(detail + '?productId=335195', 'POST', false, 'fetch'), false);
assert.equal(allowedRequest(detail + '?CategoryUrl=rau-sach&ProductUrl=cai-ngot-tui-400gr&provinceId=3&wardId=4&districtId=0&storeId=5', 'GET', false, 'fetch'), true);
assert.equal(allowedRequest(detail + '?CategoryUrl=rau-sach&ProductUrl=cai-ngot-tui-400gr&productId=1', 'GET', false, 'fetch'), false);
assert.equal(allowedRequest('https://www.bachhoaxanh.com/gio-hang', 'GET', true, 'document'), false);
assert.equal(allowedRequest('https://www.bachhoaxanh.com/gio-hang', 'GET', true, 'document', '/gio-hang'), true);
for (const path of ['/cart', '/gio-hang?token=PRIVATE', '/gio-hang#x']) {
  assert.equal(allowedRequest('https://www.bachhoaxanh.com' + path, 'GET', true, 'document', '/gio-hang'), false);
}
assert.equal(allowedRequest('https://www.bachhoaxanh.com/rau-sach/cai-ngot-tui-400gr', 'GET', true, 'document'), true);
const observed = { HttpCode: 200, ResultCode: 0, Value: {
  TotalItemShow: 0, GroupSOStep2InCart: null, CartTotal: { Total: 0 }, CartId: 'synthetic-cart' } };
for (const groups of [null, []]) {
  const result = projectCart({ ...observed, Value: { ...observed.Value, GroupSOStep2InCart: groups } });
  assert.equal(result.empty_verified, true);
  assert.equal(result.line_schema_verified, false);
  assert.equal(result.mutations_enabled, false);
  assert.equal(result.totals['CartTotal.Total'], 0);
  assert.doesNotMatch(JSON.stringify(result), /CartId|synthetic-cart/);
}
// Inactive lines still belong to user, even when active count and total are zero.
for (const inactive of [null, { ListCartItemBuy: [] }]) {
  assert.equal(projectCart({ ...observed, Value: { ...observed.Value,
    GroupCartOff: inactive } }).empty_verified, true);
}
for (const inactive of [{ ListCartItemBuy: [{ Id: 335195 }] }, {}, [], false,
  { ListCartItemBuy: null }, { ListCartItemBuy: {} }]) {
  assert.throws(() => projectCart({ ...observed, Value: { ...observed.Value,
    GroupCartOff: inactive } }));
}
for (const [field, values] of [
  ['GroupSOStep2InCart', [undefined, {}, false, '', [{}], [{ ListCartItemBuy: [] }], [{ ListCartItemBuy: [{}] }]]],
  ['CartTotal', [undefined, null, [], 0, {}, { Total: '0' }, { Total: null }, { Total: NaN },
    { Total: Infinity }, { Total: Number.MAX_SAFE_INTEGER + 1 }, { Total: -1 }, { Total: 1 },
    { Total: 0, ListCartItemBuy: [{}] }, Object.create({ Total: 0 })]],
  ['TotalItemShow', [undefined, null, '0', -1, 1, NaN, Infinity, 0.5]],
]) {
  for (const value of values) assert.throws(() => projectCart({ ...observed,
    Value: { ...observed.Value, [field]: value } }), field);
  const missing = { ...observed.Value };
  delete missing[field];
  assert.throws(() => projectCart({ ...observed, Value: missing }), 'missing ' + field);
  assert.throws(() => projectCart({ ...observed,
    Value: Object.assign(Object.create({ [field]: observed.Value[field] }), missing) }), 'inherited ' + field);
}
for (const field of ['Items', 'Products', 'CartItems', 'OrderItems', 'OrderDetails', 'ProductList', 'ListProduct', 'Lines', 'ListCartItemBuy']) {
  for (const value of [[{}], null, {}]) assert.throws(() => projectCart({ ...observed,
    Value: { ...observed.Value, [field]: value } }), field);
}
const payload = { ...observed, Value: { ...observed.Value, Items: [], Total: 0,
  ShipAddressId: 2, StoreId: 5, PRIVATE_ACCOUNT_KEY: 'PRIVATE' } };
const projection = projectCart(payload);
assert.equal(projection.empty_verified, true);
assert.equal(projection.mutations_enabled, false);
assert.deepEqual(projection.collections, { GroupSOStep2InCart: { type: 'null', empty: true }, Items: { type: 'array', empty: true } });
assert.doesNotMatch(JSON.stringify(projection), /PRIVATE|ShipAddressId|StoreId/);
const unknown = projectCart({ ...payload, Value: { ...payload.Value, UnknownArray: [{ secret: 'PRIVATE' }],
  Account: [], AddressList: [], Token: [], OrderId: [], 'bad_key': [], 'Private123': [] } });
assert.equal(unknown.observed_array_types, undefined);
assert.equal(unknown.empty_verified, true);
assert.doesNotMatch(JSON.stringify(unknown), /PRIVATE|Account|AddressList|Token|OrderId|bad_key|Private123|UnknownArray/);
const nested = projectCart({ ...payload, Value: { ...observed.Value,
  Cart: { Order: { Lines: [], TotalPrice: 0, Phone: 'PRIVATE' } } } });
assert.deepEqual(nested.collections, { GroupSOStep2InCart: { type: 'null', empty: true }, 'Cart.Order.Lines': { type: 'array', empty: true } });
assert.equal(nested.schema_status, 'EMPTY_COLLECTIONS_LINE_SCHEMA_UNKNOWN');
assert.throws(() => projectCart({ ...payload, Value: { TotalItemShow: 0 } }));
assert.doesNotMatch(JSON.stringify(nested), /Phone|PRIVATE/);
assert.throws(() => projectCart({ ...payload, Value: { ...observed.Value, Cart: { Lines: [{}] } } }));
for (const changes of [{ TotalItemShow: 1 }, { Items: [{ ProductId: 335195 }] },
  { Total: 10000 }, { TotalItemShow: '0' }, { Items: null }, { Total: NaN }]) {
  assert.throws(() => projectCart({ ...payload, Value: { ...payload.Value, ...changes } }));
}
for (const invalid of [null, {}, { HttpCode: 401 }, { ...payload, ResultCode: 1 }]) {
  assert.throws(() => projectCart(invalid));
}
const profile = { isSuccess: true, data: { entityId: 1,
  addressReceiver: [{ addressId: 2, provinceId: 3, wardId: 4 }] } };
const delivery = { provinceId: 3, wardId: 4, storeId: 5 };
const baseline = contextSnapshot(profile, payload.Value, delivery);
assert.equal(contextSnapshot(profile, payload.Value, delivery), baseline);
assert.notEqual(contextSnapshot({ ...profile, data: { ...profile.data, entityId: 99 } }, payload.Value, delivery), baseline);
assert.throws(() => contextSnapshot(profile, { ...payload.Value, ShipAddressId: 99 }, delivery));
assert.throws(() => contextSnapshot(profile, payload.Value, { ...delivery, storeId: 99 }));
assert.throws(() => contextSnapshot(null, payload.Value, delivery));


assert.deepEqual(blockedKnownRequest(api + 'get?token=PRIVATE', 'OPTIONS'), { route: '/gw/cart/api/OrderV2/get', method: 'OPTIONS' });
assert.equal(blockedKnownRequest(api + 'PRIVATE?token=PRIVATE', 'GET'), null);
assert.equal(blockedKnownRequest('https://other.example/gw/cart/api/OrderV2/get', 'GET'), null);
assert.equal(blockedKnownRequest(api + 'get', 'PRIVATE'), null);
assert.equal(allowedRequest(api + 'get', 'OPTIONS', false, 'fetch'), false);

for (const [suffix, method, expected] of [
  ['refresh-token', 'POST', true], ['refresh-token', 'GET', false],
  ['refresh-token?x=1', 'POST', false], ['logout', 'POST', false],
  ['sessions', 'POST', false], ['verify', 'POST', false], ['resend-otp', 'POST', false],
]) assert.equal(allowedRequest('https://api.bachhoaxanh.com/gw/bhx-api-identity/api/v1/auth/aio/' + suffix, method, false, 'fetch'), expected);

for (const url of ['https://untrusted.example/pixel?cartId=private',
  'https://bhxcdn.vn/other/script.js', 'https://bhxcdn.vn/bhx/product-fe/cart/a.js?token=private'])
  assert.equal(allowedRequest(url, 'GET', false, 'script'), false);
assert.equal(allowedRequest('https://bhxcdn.vn/bhx/product-fe/cart/home/_next/a.js', 'GET', false, 'script'), true);

const element = textContent => ({ textContent, getClientRects: () => [1], closest: () => null });
const heading = element('Cải ngọt túi 400g');
const primary = element('5.000đ');
let prices = [];
let buttons = [element('Mua')];
const relatedButtons = Array.from({ length: 12 }, () => element('Mua'));
let regions = [];
const region = { ...element(''), querySelectorAll: selector => selector === 'h1' ? [heading] :
  selector === ':scope > div.px-9px > button' ? buttons : selector === 'button' ? [...buttons, ...relatedButtons] :
  selector.includes('text-24') ? prices : [] };
globalThis.document = { querySelectorAll: selector => selector === 'div.sticky' ? regions : [] };
globalThis.getComputedStyle = () => ({ visibility: 'visible' });
assert.equal(productUI(), false);
assert.deepEqual(productUI(true), { selector_failure: 'MAIN_REGION_NOT_UNIQUE' });
regions = [region];
assert.equal(productUI(), false);
assert.deepEqual(productUI(true), { selector_failure: 'PRIMARY_PRICE_NOT_UNIQUE' });
prices = [primary];
assert.equal(productUI().verified5000, true);
assert.equal(productUI().main_purchase_button_unique, true);
buttons = [];
assert.equal(productUI(), false);
assert.deepEqual(productUI(true), { selector_failure: 'MAIN_PURCHASE_NOT_UNIQUE' });
buttons = [element('Mua'), element('Mua')];
assert.equal(productUI(), false);
buttons = [element('Mua')];
heading.textContent = 'Related product';
assert.equal(productUI(), false);
heading.textContent = 'Cải ngọt túi 400g';
primary.textContent = '6.000đ';
assert.equal(productUI().verified5000, false);
prices = [primary, primary];
assert.equal(productUI(), false);
prices = [primary];
regions = [region, region];
assert.equal(productUI(), false);
delete globalThis.document;
delete globalThis.getComputedStyle;
const source = readFileSync(new URL('./cart-poc.mjs', import.meta.url), 'utf8');
const capture = source.indexOf("page.on('response'");
const warmupNavigation = source.indexOf('await page.goto(ORIGIN + WARMUP');
const validated = source.indexOf('diagnostics.warmup_context_verified = true');
const productNavigation = source.indexOf('await page.goto(ORIGIN + PATH');
const headingWait = source.indexOf("await page.getByRole('heading'");
const priceWait = source.indexOf('await page.waitForFunction(productUI');
assert.ok(capture >= 0 && capture < warmupNavigation && warmupNavigation < validated &&
  validated < productNavigation && productNavigation < headingWait && headingWait < priceWait);
assert.match(source.slice(warmupNavigation, validated), /await drain\(\);[\s\S]*if \(!check\(\)\)/);
assert.doesNotMatch(source, /\.click\(/);
assert.ok(source.indexOf("if (!refreshVerified || !navigationReadVerified) fail('CART_ROUTE_READ_NOT_OBSERVED');") < source.indexOf("const output = await open"));
assert.match(source, /navigationReads\.has\(response\.request\(\)\)/);
assert.match(source, /request\.frame\(\)\.url\(\) === ORIGIN \+ '\/gio-hang'/);
console.log('PASS: cart offline request/context/schema/privacy/UI guards; browser not run.');
