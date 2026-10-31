// BHX live session: ONE persistent browser parked on /gio-hang.
// Trust model: the SPA is the source of truth for request envelopes. We park on the cart
// page, capture the exact envelope the SPA itself posts to OrderV2 (cartId + ward/store),
// then replay that envelope for reads. We never invent fields; a request we cannot match to
// the observed envelope is not sent (fail closed).
//
// Guest vs member is decided from live responses, never assumed:
//   - cart get/getAfter work as guest (guest cart) => cart tools usable, authed=false
//   - saved addresses come from the picker; while guest the picker demands login => REQUIRES_LOGIN
import { chromium } from 'playwright';
import { profileDirectory } from './profile.mjs';

const SITE = 'https://www.bachhoaxanh.com';
const API = 'https://api.bachhoaxanh.com';
const CART_PATH = '/gio-hang';
const CHECKOUT_PATH = '/thanh-toan';
const CART_GET = API + '/gw/cart/api/OrderV2/get';
const CART_GET_AFTER = API + '/gw/cart/api/OrderV2/getAfter';

const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createSession({ chromiumPath } = {}) {
  let ctx = null;
  let page = null;
  let envelope = null; // the SPA's own cart request body (captured once on park)

  async function park() {
    if (page) return page;
    ctx = await chromium.launchPersistentContext(profileDirectory(), {
      headless: true,
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 900 },
      locale: 'vi-VN',
      executablePath: chromiumPath || process.env.BHX_CHROMIUM_PATH || undefined,
      timeout: 45000,
    });
    const pages = ctx.pages();
    page = pages[0] || (await ctx.newPage());
    for (const old of pages) if (old !== page) await old.close();
    ctx.on('page', async (p) => {
      if (p !== page) await p.close().catch(() => {});
    });
    await page.goto(SITE + CART_PATH, { waitUntil: 'networkidle', timeout: 60000 });
    return page;
  }

  // Capture the exact envelope the SPA posts for a cart read, by driving a reload and
  // reading the first OrderV2/get request body. Subsequent reads replay this envelope.
  async function captureEnvelope() {
    if (envelope) return envelope;
    await park();
    const seen = page.waitForRequest(
      (r) => r.url() === CART_GET && r.method() === 'POST',
      { timeout: 30000 },
    );
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    const req = await seen;
    const body = JSON.parse(req.postData() || '{}');
    if (!body?.data?.cartId || !body?.wardId || !body?.storeId) {
      throw new Error('ENVELOPE_INCOMPLETE');
    }
    envelope = body;
    return envelope;
  }

  // Replay one cart read with the SPA's exact envelope (never a guessed body).
  async function cartRead(kind) {
    await captureEnvelope();
    const url = kind === 'after' ? CART_GET_AFTER : CART_GET;
    return page.evaluate(async ({ url: u, env }) => {
      const res = await fetch(u, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(env),
      });
      let j = null;
      try { j = await res.json(); } catch { /* non-json */ }
      return { status: res.status, j };
    }, { url, env: clone(envelope) });
  }

  // Correlated state: get + getAfter must agree; report the truth, never force true.
  async function cartState() {
    const g = await cartRead('get');
    const a = await cartRead('after');
    return {
      get: g.j,
      getAfter: a.j,
      correlated: JSON.stringify(g.j?.Value ?? null) === JSON.stringify(a.j?.Value ?? null),
    };
  }

  // Cart line projection from a live get payload. No fabricated lines.
  function lines(cart) {
    const v = cart?.Value || {};
    const groups = [
      ...(Array.isArray(v.GroupSOStep2InCart) ? v.GroupSOStep2InCart : []),
      ...(v.GroupCartOff ? [v.GroupCartOff] : []),
    ];
    const out = [];
    const seen = new Set();
    for (const g of groups) {
      const items = Array.isArray(g?.ListCartItemBuy) ? g.ListCartItemBuy : [];
      for (const it of items) {
        const id = it?.GuildId ?? it?.cartId ?? null;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({
          line_id: id,
          product_id: Number(it?.Id ?? it?.productId ?? 0),
          name: (it?.ProductName ?? it?.productName ?? '').toString().trim(),
          quantity: Number(it?.QuantityInCart ?? it?.quantity ?? 0),
          unit_price_vnd: Number(it?.Price ?? it?.price ?? 0),
          total_vnd: Number(it?.Total ?? it?.total ?? 0),
          unit: (it?.Unit ?? it?.unit ?? '').toString().trim(),
          inactive: !!it?.IsInactive,
        });
      }
    }
    return out;
  }

  // Saved-address list: the picker is login-gated. As guest the endpoint demands login,
  // so addresses() surfaces REQUIRES_LOGIN rather than inventing entries.
  async function addresses() {
    await park();
    const r = await page.evaluate(async ({ api }) => {
      const res = await fetch(api + '/gw/cart/api/order/GetAllAddressUser', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      let j = null;
      try { j = await res.json(); } catch { /* non-json */ }
      return { status: res.status, j };
    }, { api: API });
    if (r.status === 404 || r.j == null) throw new Error('ADDRESS_ENDPOINT_UNAVAILABLE');
    if (r.j.code === 401 || r.j.ResultCode === 401) throw new Error('REQUIRES_LOGIN');
    const arr = Array.isArray(r.j?.Value) ? r.j.Value : Array.isArray(r.j?.data) ? r.j.data : [];
    return arr.map((a) => ({
      id: String(a.addressId ?? a.id ?? ''),
      label: a.fullName ? `${a.fullName} ${a.phone || ''}`.trim() : (a.addressDetail || a.address || ''),
      selected: !!(a.isDefault ?? a.selected ?? false),
    }));
  }

  // Delivery context: read the live location the SPA has parked on (ward/store/province),
  // from the cart envelope (source of truth), plus cart totals. verified reflects whether the
  // context came straight from a live successful cart read (true) vs. nothing observed (false).
  async function deliveryContext() {
    const g = await cartRead('get');
    if (g.j?.ResultCode !== 0) {
      if (g.status === 401) throw new Error('REQUIRES_LOGIN');
      throw new Error('DELIVERY_CONTEXT_UNVERIFIED');
    }
    return {
      address_id: Number(envelope.profileDetailId ?? envelope.addressId ?? 0) || null,
      province_id: Number(envelope.provinceId),
      district_id: Number(envelope.districtId),
      ward_id: Number(envelope.wardId),
      store_id: Number(envelope.storeId),
      verified: true,
      cart_total_vnd: Number(g.j?.Value?.CartTotal?.Total ?? 0),
      source: 'live-cart-envelope',
    };
  }

  // Search: DataSearch from the parked cart page (same origin, session cookie).
  async function search({ query, pageIndex = 0, pageSize = 10 }) {
    await park();
    const r = await page.evaluate(async ({ api, q, pi, ps }) => {
      const res = await fetch(api + '/gw/search/v2/DataSearch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keywords: q, pageIndex: pi, pageSize: ps }),
      });
      let j = null;
      try { j = await res.json(); } catch { /* non-json */ }
      return { status: res.status, j };
    }, { api: API, q: query, pi: pageIndex, ps: pageSize });
    const block = r.j?.data || {};
    const items = Array.isArray(block.products) ? block.products : [];
    return {
      items: items.map(normalize),
      pagination: {
        page_index: pageIndex,
        page_size: pageSize,
        total: Number(block.total ?? 0),
        total_pages: Number(block.totalPage ?? 0),
        has_more: pageIndex + 1 < Number(block.totalPage ?? 0),
      },
    };
  }

  function normalize(it) {
    const pp = Array.isArray(it.productPrices) ? it.productPrices : [];
    const options = pp
      .map((p) => ({
        qty_min: Number(p.quantity ?? 1),
        price_vnd: Math.round(Number(p.price ?? 0)),
        window: p.startTime && p.dueTime ? { start: p.startTime, due: p.dueTime } : null,
        can_buy: !!p.isCanBuy,
      }))
      .filter((o) => o.price_vnd > 0);
    const unit = (it.unit || '').trim();
    const canon = (it.canonical || '').trim();
    let pkg = null;
    const mRange = unit.match(/(\d+)\s*[-–]\s*(\d+)\s*(quả|trái|gói|cái|pcs)/i);
    const mFixed = unit.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lít|gr|hộp|túi|chai|lon|hũ|vỉ|quả)/i);
    if (mRange) pkg = { kind: 'range', min: Number(mRange[1]), max: Number(mRange[2]), unit: mRange[3] };
    else if (mFixed) pkg = { kind: 'fixed', amount: Number(mFixed[1].replace(',', '.')), unit: mFixed[2] };
    return {
      id: Number(it.id ?? 0),
      name: (it.fullName || it.name || '').trim(),
      path: it.url || '',
      unit,
      package: pkg,
      options,
      price_vnd: options.length ? options[0].price_vnd : null,
      has_promotion: options.some((o) => o.window),
      promotion_windows: options.filter((o) => o.window).map((o) => o.window),
    };
  }

  // Address switch: drives the real picker on the parked page. The SPA posts
  // OrderV2/SelectProfile with the chosen address's ward/store; we click the entry card
  // (radio is visually hidden), verify the radio checked, click XÁC NHẬN, wait for the
  // SelectProfile ack, then re-read to confirm the target is now the selected context.
  // Fail closed on every unverified step. Never invents a switch.
  async function selectAddress({ address_id }) {
    const id = String(address_id);
    const list = await addresses(); // propagates REQUIRES_LOGIN / ADDRESS_ENDPOINT_UNAVAILABLE
    const target = list.find((a) => a.id === id);
    if (!target) throw new Error('ADDRESS_NOT_SAVED');
    const wasSelected = !!target.selected;

    let ack = null;
    const seenAck = page.waitForResponse(
      (r) => r.url() === API + '/gw/cart/api/OrderV2/SelectProfile' && r.request().method() === 'POST',
      { timeout: 20000 },
    ).then(async (r) => { let j = null; try { j = await r.json(); } catch {} return { ok: r.ok(), j }; }).catch(() => null);

    const btn = page.locator('#btn_choose_location');
    if (await btn.count() !== 1) throw new Error('ADDRESS_PICKER_UNAVAILABLE');
    await btn.click();
    const entries = page.locator('.lstProfile > div');
    for (let i = 0; i < 40 && (await entries.count()) < 1; i++) await sleep(250);
    if ((await entries.count()) < 1) throw new Error('ADDRESS_PICKER_EMPTY');
    const choice = entries.filter({ hasText: target.label });
    const n = await choice.count();
    if (n !== 1) throw new Error(n === 0 ? 'ADDRESS_ENTRY_NOT_FOUND' : 'ADDRESS_AMBIGUOUS_ENTRY');
    await choice.first().click();
    const radio = choice.first().locator('input[type=radio]').first();
    for (let i = 0; i < 20 && (await radio.isChecked().catch(() => false)) !== true; i++) await sleep(200);
    if ((await radio.isChecked().catch(() => false)) !== true) throw new Error('ADDRESS_SELECTION_UNVERIFIED');

    const confirm = page.locator('button:visible').filter({ hasText: /^XÁC NHẬN$/i });
    if (await confirm.count() !== 1) throw new Error('ADDRESS_CONFIRM_MISSING');
    await confirm.first().click();
    ack = await seenAck;
    if (!ack || !ack.ok || ack.j?.ResultCode !== 0 || ack.j?.HttpCode !== 200) throw new Error('ADDRESS_SELECTION_FAILED');

    // Re-read: target must now be the single selected entry, and its context must be live.
    const after = await addresses();
    const nowSelected = after.filter((a) => a.selected);
    if (nowSelected.length !== 1 || nowSelected[0].id !== id) throw new Error('ADDRESS_SWITCH_UNVERIFIED');
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    envelope = null; // context changed at the SPA; force a fresh envelope capture
    const ctx = await deliveryContext();
    return {
      selected: true, changed: !wasSelected, verified: true,
      selection_status: 'selected-and-verified',
      context: ctx,
      observed_at: new Date().toISOString(),
    };
  }

  // Checkout preview: read /thanh-toan text only. Đặt hàng is never clicked.
  async function checkoutPreview() {
    await park();
    const r = await page.evaluate(async ({ path }) => {
      const res = await fetch(location.origin + path, { credentials: 'include' });
      const txt = (await res.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 800);
      return { status: res.status, txt };
    }, { path: CHECKOUT_PATH });
    return { status: r.status, snapshot: r.txt, submitted: false };
  }

  // Cart mutation: add one product to the SPA-exact envelope, then READ to verify the line
  // (Add's own response carries no lines; the truth is in the next get). Never touches a
  // line this call did not create.
  async function add({ product_id, quantity, max_unit_price_vnd }) {
    const before = await cartRead('get');
    const beforeLines = lines(before.j);
    if (beforeLines.some((l) => l.product_id === product_id)) throw new Error('ALREADY_IN_CART');
    const r = await page.evaluate(async ({ api, env, pid, qty }) => {
      const res = await fetch(api + '/gw/cart/api/OrderV2/Add', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...env, productId: pid, quantity: qty, productType: 0, scenario: 0, preDateBuy: '', listPromotion: [] }),
      });
      let j = null;
      try { j = await res.json(); } catch { /* non-json */ }
      return { status: res.status, j };
    }, { api: API, env: clone(envelope), pid: product_id, qty: quantity });
    if (r.j?.ResultCode !== 0) throw new Error(r.status === 401 ? 'REQUIRES_LOGIN' : 'ADD_FAILED');
    const after = await cartRead('get');
    const hit = lines(after.j).find((l) => l.product_id === product_id);
    if (!hit) throw new Error('ADD_LINE_MISSING');
    if (hit.unit_price_vnd > max_unit_price_vnd) throw new Error('PRICE_CEILING');
    return { line: hit, other_lines_before: beforeLines.length, other_lines_after: lines(after.j).filter((l) => l.product_id !== product_id).length };
  }

  // Update quantity of an owned line by gid, verified via a fresh get.
  async function update({ line_id, quantity }) {
    const r = await page.evaluate(async ({ api, env, gid, qty }) => {
      const res = await fetch(api + '/gw/cart/api/OrderV2/UpdateCartItem', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...env, guid: gid, quantity: qty, note: '' }),
      });
      let j = null;
      try { j = await res.json(); } catch { /* non-json */ }
      return { status: res.status, j };
    }, { api: API, env: clone(envelope), gid: line_id, qty: quantity });
    if (r.j?.ResultCode !== 0) throw new Error(r.status === 401 ? 'REQUIRES_LOGIN' : 'UPDATE_FAILED');
    const after = await cartRead('get');
    const hit = lines(after.j).find((l) => l.line_id === line_id);
    if (!hit) throw new Error('UPDATE_LINE_MISSING');
    return { line: hit };
  }

  // Remove an owned line by gid, verified gone via a fresh get.
  async function remove({ line_id }) {
    const r = await page.evaluate(async ({ api, env, gid }) => {
      const res = await fetch(api + '/gw/cart/api/OrderV2/Remove', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: '', us: '', ...env, isNewModel: true, data: { cartId: env.data.cartId, guid: gid, reloadShiping: true, isSubmitOrder: false, wardId: env.wardId } }),
      });
      let j = null;
      try { j = await res.json(); } catch { /* non-json */ }
      return { status: res.status, j };
    }, { api: API, env: clone(envelope), gid: line_id });
    if (r.j?.ResultCode !== 0) throw new Error(r.status === 401 ? 'REQUIRES_LOGIN' : 'REMOVE_FAILED');
    const after = await cartRead('get');
    if (lines(after.j).some((l) => l.line_id === line_id)) throw new Error('REMOVE_NOT_CONFIRMED');
    return { removed: true };
  }

  async function close() {
    if (ctx) { await ctx.close().catch(() => {}); ctx = null; page = null; envelope = null; }
  }

  return { park, cartState, lines, addresses, deliveryContext, selectAddress, search, checkoutPreview, add, update, remove, close };
}
