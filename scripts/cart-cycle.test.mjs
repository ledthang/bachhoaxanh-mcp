import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAdd, guardRequest } from './cart-cycle.mjs';
import { projectCart } from './cart-poc.mjs';
const baseline = { provinceId: 3, wardId: 4, districtId: 0, storeId: 5, cartId: 'offline-cart' };
const body = { ...baseline, productId: 335195, quantity: 1, productType: 0, scenario: 0,
  preDateBuy: '', listPromotion: [] };
const raw = JSON.stringify(body);
assert.equal(validateAdd(raw, baseline), true);
for (const malformed of ['', '{', 'null', '[]', '{}', raw.slice(0, -1) + ',"quantity":1}',
  raw.slice(0, -1) + ',"quanti\\u0074y":1}']) assert.equal(validateAdd(malformed, baseline), false);
for (const [key, value] of Object.entries(body)) {
  const missing = { ...body }; delete missing[key];
  assert.equal(validateAdd(JSON.stringify(missing), baseline), false);
  assert.equal(validateAdd(JSON.stringify({ ...body, [key]: {} }), baseline), false);
  if (typeof value === 'number') assert.equal(validateAdd(JSON.stringify({ ...body, [key]: String(value) }), baseline), false);
}
for (const changes of [{ quantity: 2 }, { productId: 1 }, { provinceId: 9 }, { wardId: 9 },
  { districtId: 9 }, { storeId: 9 }, { cartId: 'wrong' }, { extra: true }, { productType: -1 },
  { scenario: 0.5 }, { preDateBuy: null }, { listPromotion: [{}] }]) {
  assert.equal(validateAdd(JSON.stringify({ ...body, ...changes }), baseline), false);
}
const frame = {};
const add = 'https://api.bachhoaxanh.com/gw/cart/api/OrderV2/Add';
for (const [url, method, armed, data, expected] of [
  [add, 'POST', true, raw, true], [add, 'POST', false, raw, false],
  [add, 'POST', true, '{}', false], [add, 'GET', true, raw, false],
  [add + '?x=1', 'POST', true, raw, false],
  [add.replace('/Add', '/CheckValidateCart'), 'POST', true, raw, false],
  [add.replace('/Add', '/Update'), 'POST', true, raw, false],
  [add.replace('/Add', '/Remove'), 'POST', true, raw, false],
]) {
  let aborted = 0;
  const state = { failed: false, armed, addCount: 0, baseline };
  const route = { request: () => ({ url: () => url, method: () => method,
    frame: () => frame, isNavigationRequest: () => false, resourceType: () => 'fetch',
    headers: () => ({ 'content-type': 'application/json' }), postData: () => data }),
  abort: async () => { aborted += 1; }, continue: async () => assert.fail('mutation forwarded') };
  await guardRequest(route, state, frame);
  assert.equal(aborted, 1);
  assert.equal(Boolean(state.addValid), expected);
  if (expected) { await guardRequest(route, state, frame); assert.equal(state.failed, true); }
}
// Only the observed, context-bound popup read may precede Add.
const popup = 'https://api.bachhoaxanh.com/gw/Product/GetPopupProduct?productId=335195&provinceId=3&wardId=4&StoreId=5&PopupProductType=1&quantityInApp=1&isShowPopup=true';
for (const [url, method, expected] of [[popup, 'GET', true], [popup, 'POST', false],
  [popup.replace('StoreId=5','StoreId=6'), 'GET', false],
  [popup+'&extra=1','GET',false], [popup+'&productId=335195','GET',false]]) {
  const state = { failed:false, armed:true, addCount:0, baseline };
  let forwarded=0;
  await guardRequest({ request:()=>({url:()=>url,method:()=>method,frame:()=>frame,
    isNavigationRequest:()=>false,resourceType:()=> 'fetch'}),
    abort:async()=>{},continue:async()=>{forwarded++;} },state,frame);
  assert.equal(forwarded,Number(expected));
  assert.equal(state.failed,!expected);
}
for (const changes of [{ armed:false }, { failed:true }, { baseline:undefined },
  { requestFrame:{} }, { navigation:true }]) {
  const state={failed:false,armed:true,addCount:0,baseline,...changes};
  let aborted=0, forwarded=0;
  await guardRequest({request:()=>({url:()=>popup,method:()=> 'GET',
    frame:()=>changes.requestFrame||frame,isNavigationRequest:()=>Boolean(changes.navigation),
    resourceType:()=> 'fetch'}),abort:async()=>{aborted++;},
    continue:async()=>{forwarded++;}},state,frame);
  assert.equal(forwarded,0);
  assert.equal(aborted,1);
  assert.equal(state.failed,true);
}
// Blocking a purchase prerequisite must not look like a valid Add preflight.
{
  const state = { failed: false, armed: true, addCount: 0, baseline };
  let aborted = 0;
  await guardRequest({ request: () => ({
    url: () => 'https://api.bachhoaxanh.com/gw/Product/GetPopupProduct?productId=335195',
    method: () => 'GET', frame: () => frame, isNavigationRequest: () => false,
    resourceType: () => 'fetch',
  }), abort: async () => { aborted++; }, continue: async () => assert.fail('unexpected forwarding') }, state, frame);
  assert.equal(aborted, 1);
  assert.equal(state.failed, true);
}
assert.equal(projectCart({ HttpCode: 200, ResultCode: 0, Value: {
  TotalItemShow: 0, GroupSOStep2InCart: null, CartTotal: { Total: 0 },
  UnknownItems: [{ ProductId: 1 }],
} }).empty_verified, true);
const source = readFileSync(new URL('./cart-cycle.mjs', import.meta.url), 'utf8');
assert.ok(source.indexOf("page.on('response'") < source.indexOf('await page.goto('));
assert.ok(source.indexOf("browser.route('**/*'") < source.indexOf('await page.goto('));
assert.doesNotMatch(source, /console\.(?:error|warn)|writeFile|CheckValidateCart|checkout|payment/);
console.log('PASS: offline Add schema, abort-only guard, observation ordering; existing empty-schema blocker reproduced.');
