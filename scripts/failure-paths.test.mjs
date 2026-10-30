// Failure-path regression: every failure must fail CLOSED with the exact code and
// must NOT perform the write. Offline: fakes only, no browser, no network.
import assert from 'node:assert/strict';
import { selectAddress, selectionAllowed, validateAddressInput } from '../src/delivery.mjs';
import { createHandler } from '../src/server.mjs';

// ---------- helper to build valid saved-address fixtures ----------
const HOME = { id: '90713515', selected: true, address: '140/30 Nguyễn Chánh', wardId: '101462' };
const OTHER = { id: '110346409', selected: false, address: '205 Trần Phú', wardId: '101469' };
const ctx = (a, store) => ({ address_id: a.id, province_id: '1020', ward_id: a.wardId, store_id: String(store), verified: true });
// default snapshot: HOME is the one selected row and the live context; target under test = OTHER.
const snap = ({ addresses = [HOME, OTHER], context = ctx(HOME, 14524), cart = { items: [], total: 0 }, auth = true } = {}) => ({
  authenticated: auth, requires_login: !auth, addresses, context, cart, observed_at: '2026-10-30T10:00:00.000Z',
});

// ---------- selectAddress failure paths (apply never runs) ----------
async function expectFail(label, input, snapshotReader, code, applyCalls) {
  let applied = 0;
  const err = await selectAddress(input, snapshotReader, async () => { applied++; throw Error(code); }).then(
    () => null, e => e);
  assert.ok(err, `${label}: must reject`);
  assert.equal(err.message, code, `${label}: exact code`);
  assert.equal(applied, applyCalls ?? 1, `${label}: apply called exactly once (guard is upstream of apply)`);
}

// 1 unauthenticated snapshot -> no apply attempt is made downstream of context check
{
  const err = await selectAddress({ address_id: HOME.id }, async () => { throw Error('boom'); },
    async () => { throw new Error('apply must not run'); }).then(() => null, e => e);
  assert.equal(err.message, 'BHX_AUTH_CONTEXT_REQUIRED');
}
// 2 target not a saved address -> BHX_ADDRESS_NOT_SAVED, apply not run
{
  let applied = 0;
  const err = await selectAddress({ address_id: '777' }, async () => snap(),
    async () => { applied++; throw Error('apply must not run'); }).then(() => null, e => e);
  assert.equal(err.message, 'BHX_ADDRESS_NOT_SAVED');
  assert.equal(applied, 0, 'apply must not run for unsaved address');
}
// 3 duplicate saved rows for the same id -> BHX_ADDRESS_NOT_SAVED (exactly-one rule)
{
  let applied = 0;
  const dup = [HOME, { ...HOME }, OTHER];
  const err = await selectAddress({ address_id: HOME.id }, async () => snap({ addresses: dup }),
    async () => { applied++; }).then(() => null, e => e);
  assert.equal(err.message, 'BHX_ADDRESS_NOT_SAVED');
  assert.equal(applied, 0);
}
// 4 nonempty cart -> BHX_ADDRESS_NONEMPTY_CART, apply not run (no write on blocked change)
{
  let applied = 0;
  const err = await selectAddress({ address_id: OTHER.id },
    async () => snap({ cart: { items: [{ line_id: 'l1', quantity: 2 }], total: 40000 } }),
    async () => { applied++; }).then(() => null, e => e);
  assert.equal(err.message, 'BHX_ADDRESS_NONEMPTY_CART');
  assert.equal(applied, 0, 'apply must not run when cart nonempty');
}
// 5 unverified context -> BHX_DELIVERY_CONTEXT_UNVERIFIED
{
  let applied = 0;
  const err = await selectAddress({ address_id: OTHER.id },
    async () => snap({ context: { ...ctx(OTHER, 14509), verified: false } }),
    async () => { applied++; }).then(() => null, e => e);
  assert.equal(err.message, 'BHX_DELIVERY_CONTEXT_UNVERIFIED');
  assert.equal(applied, 0);
}
// 6 two addresses flagged selected -> BHX_DELIVERY_CONTEXT_UNVERIFIED
{
  let applied = 0;
  const err = await selectAddress({ address_id: OTHER.id },
    async () => snap({ addresses: [{ ...HOME, selected: true }, { ...OTHER, selected: true }] }),
    async () => { applied++; }).then(() => null, e => e);
  assert.equal(err.message, 'BHX_DELIVERY_CONTEXT_UNVERIFIED');
  assert.equal(applied, 0);
}
// 7 apply runs but post-restart snapshot throws -> BHX_ADDRESS_RESTART_UNVERIFIED
{
  let n = 0;
  const err = await selectAddress({ address_id: OTHER.id },
    async () => { n++; if (n === 1) return snap(); throw Error('restart failed'); },
    async () => {}).then(() => null, e => e);
  assert.equal(err.message, 'BHX_ADDRESS_RESTART_UNVERIFIED');
}
// 8 restart ok but cart gained a line -> BHX_ADDRESS_CART_CHANGED (write leaked)
{
  let n = 0;
  const err = await selectAddress({ address_id: OTHER.id },
    async () => { n++; return n === 1 ? snap() : snap({ cart: { items: [{ line_id: 'ghost' }], total: 9000 } }); },
    async () => {}).then(() => null, e => e);
  assert.equal(err.message, 'BHX_ADDRESS_CART_CHANGED');
}
// 9 post-restart context shows a different address than requested -> BHX_DELIVERY_CONTEXT_CHANGED
{
  let n = 0;
  const err = await selectAddress({ address_id: OTHER.id },
    async () => { n++; return n === 1 ? snap() : snap({ addresses: [HOME, OTHER], context: ctx(HOME, 14524) }); },
    async () => {}).then(() => null, e => e);
  assert.equal(err.message, 'BHX_DELIVERY_CONTEXT_CHANGED');
}
// invalid input shapes need no snapshot at all
for (const bad of [null, {}, { address_id: '0' }, { address_id: '01' }, { address_id: 12 }, { address_id: '1', x: 2 }]) {
  let snaps = 0;
  const err = await selectAddress(bad, async () => { snaps++; return snap(); }, async () => {}).then(() => null, e => e);
  assert.equal(err.message, 'INVALID_ADDRESS_ID');
  assert.equal(snaps, 0, 'invalid input must not read snapshot');
}

// ---------- selectionAllowed request-contract failures ----------
const base = { cartId: 'c1', address: { addressId: 110346409, districtId: 10020, provinceId: 1020, wardId: 101469, lat: '16.06', lng: '108.22' } };
const good = { data: { CartId: 'c1', Lat: 16.06, Lng: 108.22, ProfileDetailId: 110346409, ProfileDetailIds: [], wardId: 101469 }, districtId: 10020, provinceId: 1020, storeId: 14509, wardId: 101469, isNewModel: true };
assert.equal(selectionAllowed('https://api.bachhoaxanh.com/gw/cart/api/OrderV2/SelectProfile', 'POST', good, base), true);
for (const [label, mutation] of [
  ['wrong url', () => ({ u: 'https://api.bachhoaxanh.com/gw/cart/api/OrderV2/Add' })],
  ['GET not allowed', () => ({ m: 'GET' })],
  ['no address baseline', () => ({ base: { cartId: 'c1' } })],
  ['extra top-level field', () => ({ b: { ...good, isSubmitOrder: true } })],
  ['missing isNewModel', () => ({ b: (({ isNewModel, ...r }) => r)(good) })],
  ['isNewModel false', () => ({ b: { ...good, isNewModel: false } })],
  ['wrong ward', () => ({ b: { ...good, wardId: 999 } })],
  ['wrong province', () => ({ b: { ...good, provinceId: 1 } })],
  ['wrong district', () => ({ b: { ...good, districtId: 1 } })],
  ['storeId 0 (no store resolved)', () => ({ b: { ...good, storeId: 0 } })],
  ['storeId negative', () => ({ b: { ...good, storeId: -5 } })],
  ['storeId non-integer', () => ({ b: { ...good, storeId: 14509.5 } })],
  ['wrong cartId', () => ({ b: { ...good, data: { ...good.data, CartId: 'other' } } })],
  ['wrong ProfileDetailId', () => ({ b: { ...good, data: { ...good.data, ProfileDetailId: 42 } } })],
  ['nonempty ProfileDetailIds', () => ({ b: { ...good, data: { ...good.data, ProfileDetailIds: [1] } } })],
  ['inner ward mismatch', () => ({ b: { ...good, data: { ...good.data, wardId: 1 } } })],
  ['inner extra field', () => ({ b: { ...good, data: { ...good.data, Extra: 1 } } })],
  ['lat/lng not finite', () => ({ b: { ...good, data: { ...good.data, Lat: Infinity } } })],
]) {
  const o = mutation();
  const u = o.u ?? 'https://api.bachhoaxanh.com/gw/cart/api/OrderV2/SelectProfile';
  const m = o.m ?? 'POST';
  const b = o.b ?? good;
  const bl = o.base ?? base;
  assert.equal(selectionAllowed(u, m, b, bl), false, `selectionAllowed must reject: ${label}`);
}

// ---------- MCP handler failure paths (no browser, injected fakes) ----------
{
  let created = 0;
  const h = createHandler({ sessionFactory: async () => { created++; throw Error('boom'); }, snapshotReader: async () => snap(), loginFactory: () => ({ active: () => false, start: async () => ({ ok: 1 }), close: async () => {} }) });
  // call before initialize
  await assert.rejects(() => h.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bhx_get_cart', arguments: {} } }), e => e.code === -32000);
  await h.handle({ jsonrpc: '2.0', id: 9, method: 'initialize' });
  await assert.rejects(() => h.handle({ jsonrpc: '2.0', id: 2, method: 'bogus/method' }), e => e.code === -32601);
  await assert.rejects(() => h.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope', arguments: {} } }), e => e.code === -32602);
  await assert.rejects(() => h.handle({ jsonrpc: '1.0', id: 4, method: 'tools/list' }), e => e.code === -32600);
  await assert.rejects(() => h.handle({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'bhx_select_address', arguments: { address_id: '1' } } }), e => e.code === -32600);
  await assert.rejects(() => h.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'bhx_select_address', arguments: { address_id: '01' } } }), e => e.code === -32602);
  await assert.rejects(() => h.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'bhx_login_start', arguments: { x: 1 } } }), e => e.code === -32602);
  assert.equal(created, 0, 'no session created by argument failures');
  await h.close();
}
// select address: delivery code surfaces verbatim; unknown error degrades to OPERATION_UNVERIFIED
{
  for (const [thrown, expected] of [['BHX_ADDRESS_NONEMPTY_CART', 'BHX_ADDRESS_NONEMPTY_CART'],
    ['BHX_ADDRESS_SELECTION_UNVERIFIED', 'BHX_ADDRESS_SELECTION_UNVERIFIED'],
    ['weird failure', 'OPERATION_UNVERIFIED: inspect selected address or private login browser before retrying.']]) {
    const h = createHandler({ addressSelector: async () => { throw Error(thrown); }, loginFactory: () => ({ active: () => false, start: async () => ({}), close: async () => {} }) });
    await h.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    const r = await h.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bhx_select_address', arguments: { address_id: '110346409' } } });
    assert.equal(r.isError, true);
    assert.equal(r.content[0].text, expected);
    await h.close();
  }
}
// login active: address change and cart read both blocked (single browser ownership)
{
  let addressed = 0, read = 0;
  const h = createHandler({
    loginFactory: () => ({ active: () => true, start: async () => ({ status: 'interactive-login-ready' }), close: async () => {} }),
    addressSelector: async () => { addressed++; return {}; },
    snapshotReader: async () => { read++; return snap(); },
  });
  await h.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  const a = await h.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bhx_select_address', arguments: { address_id: '110346409' } } });
  assert.equal(a.isError, true);
  assert.match(a.content[0].text, /BROWSER_BUSY/);
  const b = await h.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bhx_get_cart', arguments: {} } });
  assert.equal(b.isError, true);
  assert.match(b.content[0].text, /LOGIN_IN_PROGRESS/);
  assert.equal(addressed, 0, 'address change blocked while login browser active');
  assert.equal(read, 0, 'cart read blocked while login browser active');
  await h.close();
}
// read failure -> BHX_READ_UNVERIFIED (fail closed, no mutation claimed)
{
  const h = createHandler({ snapshotReader: async () => { throw Error('net down'); } });
  await h.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  for (const name of ['bhx_get_cart', 'bhx_cart_summary', 'bhx_list_addresses', 'bhx_get_delivery_context']) {
    const r = await h.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: {} } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /BHX_READ_UNVERIFIED/);
  }
  await h.close();
}
// search query validation: control chars / blank / oversized -> -32602 before any browser
{
  const h = createHandler({ snapshotReader: async () => { throw new Error('must not open browser'); } });
  await h.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  for (const q of ['', 'x'.repeat(101), 'abc\n', 'a\u0000b']) {
    await assert.rejects(() => h.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bhx_search_products', arguments: { query: q } } }), e => e.code === -32602, `query ${JSON.stringify(q)}`);
  }
  await h.close();
}
// product/detail + availability argument failures (query must contain the id)
{
  const h = createHandler({ snapshotReader: async ({ } = {}) => snap() });
  await h.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  await assert.rejects(() => h.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bhx_get_product', arguments: { query: 'ga', product_id: 0 } } }), e => e.code === -32602);
  await assert.rejects(() => h.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bhx_check_availability', arguments: { query: 'ga', items: [] } } }), e => e.code === -32602);
  await assert.rejects(() => h.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'bhx_check_availability', arguments: { query: 'ga', items: [{ product_id: 1, quantity: 0 }] } } }), e => e.code === -32602);
  await assert.rejects(() => h.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'bhx_check_availability', arguments: { query: 'ga', items: [{ product_id: 1, quantity: 1 }, { product_id: 2, quantity: 1 }] } } }), e => e.code === -32602);
  await assert.rejects(() => h.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'bhx_check_availability', arguments: { query: 'ga', items: [{ product_id: 1, quantity: 1001 }] } } }), e => e.code === -32602);
  await h.close();
}
// mutation without explicit authorization -> -32602, session never created
{
  let created = 0;
  const h = createHandler({ sessionFactory: async () => { created++; return { mutate: async () => ({ ok: 1 }), readCart: async () => ({ items: [] }), close: async () => {} }; } });
  await h.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  await assert.rejects(() => h.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bhx_add_to_cart', arguments: { product_id: 335195, quantity: 1, max_unit_price_vnd: 6900 } } }), e => e.code === -32602);
  await assert.rejects(() => h.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bhx_add_to_cart', arguments: { product_id: 335195, quantity: 1, max_unit_price_vnd: 6900, user_authorized: false } } }), e => e.code === -32602);
  assert.equal(created, 0, 'no session for un-authorized mutation');
  await h.close();
}
// mutation unverified -> must say cleanup_required and must not auto-retry
{
  let calls = 0;
  const h = createHandler({ sessionFactory: async () => ({ mutate: async () => { calls++; throw Error('ack mismatch'); }, readCart: async () => ({ items: [] }), close: async () => {} }) });
  await h.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  const r = await h.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bhx_add_to_cart', arguments: { product_id: 335195, quantity: 1, max_unit_price_vnd: 6900, user_authorized: true } } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /cleanup_required/);
  assert.equal(calls, 1, 'exactly one attempt; no blind retry');
  await h.close();
}
// notification (no id) for a mutation: rejected with -32600, and no session created
{
  let created = 0;
  const h = createHandler({ sessionFactory: async () => { created++; return { mutate: async () => ({ ok: 1 }), readCart: async () => ({ items: [] }), close: async () => {} }; } });
  await h.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  await assert.rejects(() => h.handle({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'bhx_add_to_cart', arguments: { product_id: 335195, quantity: 1, max_unit_price_vnd: 6900, user_authorized: true } } }), e => e.code === -32600);
  assert.equal(created, 0, 'notification mutation must not create a session');
  await h.close();
}

console.log('PASS: failure paths fail closed with exact codes and perform no write (offline, no browser/network).');
