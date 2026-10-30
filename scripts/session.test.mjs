import assert from 'node:assert/strict';
import { createHandler } from '../src/server.mjs';

// ---- fake session: mirrors the REAL session.mjs method surface ----
// Internal truth is a list of RAW cart items (GuildId/Id/...); the public `lines()` is the
// projection the server consumes (line_id/...). add/update/remove operate on raw, match by
// line_id projected, and everything the server sees is derived from the one mutable cart.
function fakeSession() {
  let raw = [];                 // [{GuildId, Id, ProductName, QuantityInCart, Price, Total, Unit, IsInactive}]
  let seq = 0;
  const project = (item) => ({
    line_id: item.GuildId, product_id: Number(item.Id), name: item.ProductName,
    quantity: Number(item.QuantityInCart), unit_price_vnd: Number(item.Price),
    total_vnd: Number(item.Total), unit: item.Unit, inactive: !!item.IsInactive,
  });
  const cartPayload = () => ({
    Value: {
      TotalItemShow: raw.length,
      GroupSOStep2InCart: raw.length ? [{ ListCartItemBuy: raw }] : null,
      CartTotal: { Total: raw.reduce((a, l) => a + (l.Total || 0), 0) },
    },
  });
  return {
    async cartState() { const p = cartPayload(); return { get: p, getAfter: p, correlated: true }; },
    lines: () => raw.map(project),
    async add({ product_id, quantity, max_unit_price_vnd }) {
      if (raw.some((l) => Number(l.Id) === product_id)) throw new Error('ALREADY_IN_CART');
      const unit = 25000;
      if (unit > max_unit_price_vnd) throw new Error('PRICE_CEILING');
      const item = { GuildId: 'GUID-' + (++seq), Id: product_id, ProductName: 'Item ' + product_id, QuantityInCart: quantity, Price: unit, Total: unit * quantity, Unit: 'kg', IsInactive: false };
      raw = [...raw, item];
      return { line: project(item) };
    },
    async update({ line_id, quantity }) {
      const item = raw.find((l) => l.GuildId === line_id);
      if (!item) throw new Error('UPDATE_LINE_MISSING');
      item.QuantityInCart = quantity; item.Total = item.Price * quantity;
      return { line: project(item) };
    },
    async remove({ line_id }) {
      if (!raw.some((l) => l.GuildId === line_id)) throw new Error('REMOVE_NOT_CONFIRMED');
      raw = raw.filter((l) => l.GuildId !== line_id);
      return { removed: true };
    },
    async addresses() { return [{ id: '90713515', label: 'Nhà riêng', selected: true }]; },
    async deliveryContext() { return { province_id: 6, district_id: 1452, ward_id: 101462, store_id: 14524, verified: true, cart_total_vnd: raw.reduce((a, l) => a + (l.Total || 0), 0), source: 'live-cart-envelope' }; },
    async search(o) {
      const norm = (it) => {
        const options = (it.productPrices || []).map((p) => ({ qty_min: Number(p.quantity ?? 1), price_vnd: Math.round(Number(p.price ?? 0)), window: p.startTime && p.dueTime ? { start: p.startTime, due: p.dueTime } : null, can_buy: !!p.isCanBuy })).filter((x) => x.price_vnd > 0);
        let pkg = null; const mf = it.unit.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lít|gr|hộp|túi|chai|lon|hũ|vỉ|quả)/i);
        if (mf) pkg = { kind: 'fixed', amount: Number(mf[1].replace(',', '.')), unit: mf[2].toLowerCase() };
        return { id: it.id, name: it.fullName, path: it.url, unit: it.unit, package: pkg, options, price_vnd: options.length ? options[0].price_vnd : null, has_promotion: options.some((x) => x.window), promotion_windows: options.filter((x) => x.window).map((x) => x.window) };
      };
      const all = [
        { id: 101, fullName: 'Cà chua beef 500g', unit: 'Hộp 500Gr', url: '/cu/ca-chua-beef-500g', productPrices: [{ price: 15950, quantity: 1000, isCanBuy: true }, { price: 31900, quantity: 2000, isCanBuy: true }] },
        { id: 102, fullName: 'Trứng gà hộp 10 quả', unit: 'Hộp 10 Quả', url: '/trung-ga-hop-10-qua', productPrices: [{ price: 34000, quantity: 1, isCanBuy: true, startTime: '2026-10-30T10:00:00', dueTime: '2026-10-30T12:00:00' }] },
      ].map(norm);
      const items = all.slice(o.pageIndex * o.pageSize, o.pageIndex * o.pageSize + o.pageSize);
      return { items, pagination: { page_index: o.pageIndex, page_size: o.pageSize, total: all.length, total_pages: 1, has_more: false, pages_fetched: 1 } };
    },
    async checkoutPreview() { return { status: 200, snapshot: 'Tổng thanh toán 25.000đ', submitted: false }; },
    async close() {},
  };
}

// ---- initialize gate ----
const { handle, close } = createHandler({ sessionFactory: () => fakeSession() });
await assert.rejects(() => Promise.resolve(handle({ jsonrpc: '2.0', id: 0, method: 'tools/list' })).then(() => { throw new Error('should gate'); }), (e) => e.code === -32002);
await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
const tl = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
assert.equal(tl.tools.length, 15);

// ---- search: real pagination + ladder + package + promo window ----
const s = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bhx_search_products', arguments: { query: 'cà chua', page_size: 10 } } });
const sd = JSON.parse(s.content[0].text);
assert.equal(sd.pagination.total, 2);
assert.equal(sd.pagination.page_index, 0);
assert.equal(sd.products.length, 2);
const [a, b] = sd.products;
assert.ok(a.options.some((o) => o.qty_min === 1000 && o.price_vnd === 15950) && a.options.some((o) => o.qty_min === 2000 && o.price_vnd === 31900));
assert.equal(a.package.kind, 'fixed'); assert.equal(a.package.amount, 500); assert.equal(a.package.unit, 'g');
assert.equal(b.has_promotion, true);
assert.ok(b.promotion_windows[0].start.includes('10:00') && b.promotion_windows[0].due.includes('12:00'));

// ---- batch trial: add+remove restores ----
const t = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'bhx_check_availability', arguments: { items: [{ product_id: 101, quantity: 1 }, { product_id: 102, quantity: 2 }] } } });
const td = JSON.parse(t.content[0].text);
assert.equal(td.results.length, 2);
assert.ok(td.results.every((r) => r.status === 'purchasable_verified' && r.cart_restored));
assert.equal(td.results[0].line.unit_price_vnd, 25000);
// cart is empty again after the trial
const afterTrial = JSON.parse((await handle({ jsonrpc: '2.0', id: 44, method: 'tools/call', params: { name: 'bhx_cart_summary', arguments: {} } })).content[0].text);
assert.equal(afterTrial.items.length, 0);

// ---- checkout preview never submits ----
const c = await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'bhx_checkout_preview', arguments: {} } });
assert.equal(JSON.parse(c.content[0].text).submitted, false);

// ---- add -> update -> remove on the same real fake cart ----
const add = await handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'bhx_add_to_cart', arguments: { product_id: 777, quantity: 3, max_unit_price_vnd: 30000, user_authorized: true } } });
const added = JSON.parse(add.content[0].text);
assert.ok(added.line && added.line.quantity === 3);
const gid = added.line.line_id;
const upd = await handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'bhx_update_cart_item', arguments: { line_id: gid, quantity: 5, user_authorized: true } } });
assert.equal(JSON.parse(upd.content[0].text).line.quantity, 5);
const rm = await handle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'bhx_remove_cart_item', arguments: { line_id: gid, user_authorized: true } } });
assert.equal(JSON.parse(rm.content[0].text).removed, true);
const empty = await handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'bhx_cart_summary', arguments: {} } });
assert.equal(JSON.parse(empty.content[0].text).items.length, 0);
// update/remove on a missing line fail closed
const missUpd = await handle({ jsonrpc: '2.0', id: 91, method: 'tools/call', params: { name: 'bhx_update_cart_item', arguments: { line_id: 'NOPE', quantity: 1, user_authorized: true } } });
assert.ok(missUpd.content[0].text.startsWith('LINE_NOT_FOUND'));

// ---- address: select verifies current context, never fakes apply ----
const sel = await handle({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'bhx_select_address', arguments: { address_id: '90713515', user_authorized: true } } });
assert.equal(JSON.parse(sel.content[0].text).applied, false);

// ---- login relay gating ----
const fakeLogin = { async start() { return { status: 'otp_sent', expires_in: 120 }; }, async submit(otp) { return { status: 'logged_in', otp }; }, async close() {} };
const h2 = createHandler({ sessionFactory: () => fakeSession(), loginFactory: () => fakeLogin });
await h2.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
const st = await h2.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bhx_login_start', arguments: {} } });
assert.equal(JSON.parse(st.content[0].text).status, 'otp_sent');
const gated = await h2.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bhx_get_cart', arguments: {} } });
assert.equal(gated.isError, true);
assert.ok(gated.content[0].text.startsWith('LOGIN_IN_PROGRESS'));
const sub = await h2.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'bhx_login_submit', arguments: { otp: '123456' } } });
assert.equal(JSON.parse(sub.content[0].text).status, 'logged_in');
const cart2 = await h2.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'bhx_get_cart', arguments: {} } });
assert.equal(cart2.isError, undefined);
await h2.close();

const noId = await handle({ jsonrpc: '2.0', method: 'ping' });
assert.ok(noId);
await close();
console.log('PASS: session flow — pagination real, ladder normalized, promo windows, batch trial restores, add/update/remove on real fake cart, address context read, login relay gating.');
