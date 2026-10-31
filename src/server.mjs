// BHX MCP stdio server: ONE lazy live session (parked /gio-hang); tools call it via the
// session's SPA-exact envelope. Fail closed everywhere; auth is decided from live responses.
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createSession } from './session.mjs';
import { createLogin } from './auth.mjs';

const READONLY = { readOnlyHint: true, destructiveHint: false };

const TOOLS = [
  { name: 'bhx_auth_status', description: 'Check authenticated BHX session via live cart-page read. No side effects.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: READONLY },
  { name: 'bhx_list_addresses', description: 'List saved delivery addresses for the account. Read-only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: READONLY },
  { name: 'bhx_get_delivery_context', description: 'Current selected delivery context (province/ward/store) read from the live parked session. Read-only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: READONLY },
  { name: 'bhx_get_cart', description: 'Full authenticated cart (get + getAfter correlated). Read-only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: READONLY },
  { name: 'bhx_cart_summary', description: 'Cart totals + line summary from an authenticated read. Read-only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: READONLY },
  { name: 'bhx_search_products', description: 'Search authenticated catalog with real pagination (page_index 0-based, page_size 10|20|50). Returns options ladder + promotion windows when present. Read-only.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 100 }, page_index: { type: 'integer', minimum: 0, maximum: 40 }, page_size: { type: 'integer', enum: [10, 20, 50] } }, required: ['query'], additionalProperties: false }, annotations: READONLY },
  { name: 'bhx_get_product', description: 'Resolve one product by product_id via an id-string search (exact match required). Read-only.', inputSchema: { type: 'object', properties: { product_id: { type: 'integer', minimum: 1 } }, required: ['product_id'], additionalProperties: false }, annotations: READONLY },
  { name: 'bhx_check_availability', description: 'Batch availability trial: add each SKU to a parked cart, verify the line, remove, verify restored. Mutates transiently; ends with cart as found per item. Approved scope: bounded trial, no checkout.', inputSchema: { type: 'object', properties: { items: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', properties: { product_id: { type: 'integer', minimum: 1 }, quantity: { type: 'integer', minimum: 1, maximum: 500 }, max_unit_price_vnd: { type: 'integer', minimum: 1 } }, required: ['product_id', 'quantity'], additionalProperties: false } } }, required: ['items'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
  { name: 'bhx_checkout_preview', description: 'Read /thanh-toan displayed totals only. Never clicks Đặt hàng. No payment.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: READONLY },
  { name: 'bhx_add_to_cart', description: 'Add one product to the live cart. Requires a max_unit_price_vnd ceiling and user_authorized:true. Verifies the line after add. No checkout/payment.', inputSchema: { type: 'object', properties: { product_id: { type: 'integer', minimum: 1 }, quantity: { type: 'integer', minimum: 1, maximum: 500 }, max_unit_price_vnd: { type: 'integer', minimum: 1 }, user_authorized: { type: 'boolean', enum: [true] } }, required: ['product_id', 'quantity', 'max_unit_price_vnd', 'user_authorized'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: 'bhx_update_cart_item', description: 'Update quantity of an existing cart line by line_id. Requires user_authorized:true. Verifies after update. No checkout/payment.', inputSchema: { type: 'object', properties: { line_id: { type: 'string', minLength: 1, maxLength: 200 }, quantity: { type: 'integer', minimum: 1, maximum: 500 }, user_authorized: { type: 'boolean', enum: [true] } }, required: ['line_id', 'quantity', 'user_authorized'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: 'bhx_remove_cart_item', description: 'Remove an existing cart line by line_id. Requires user_authorized:true. Verifies the line is gone. No checkout/payment.', inputSchema: { type: 'object', properties: { line_id: { type: 'string', minLength: 1, maxLength: 200 }, user_authorized: { type: 'boolean', enum: [true] } }, required: ['line_id', 'user_authorized'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: 'bhx_login_start', description: 'Trigger OTP SMS on the configured BHX phone (headless relay). Window ~120s; reply the digits, then call bhx_login_submit. No checkout or payment.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'bhx_login_submit', description: 'Submit the relayed OTP digits into the active window started by bhx_login_start. Verifies and persists the session cookie; unverified outcomes fail closed.', inputSchema: { type: 'object', properties: { otp: { type: 'string', pattern: '^[0-9]{4,8}$' } }, required: ['otp'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'bhx_select_address', description: 'Select an existing saved delivery address by address_id and verify the fresh context. Requires user_authorized:true. No checkout/payment.', inputSchema: { type: 'object', properties: { address_id: { type: 'string', pattern: '^[1-9][0-9]{0,15}$' }, user_authorized: { type: 'boolean', enum: [true] } }, required: ['address_id', 'user_authorized'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true } },
];

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

function argCheck(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Invalid tool arguments';
  const schema = TOOL_BY_NAME[name]?.inputSchema;
  if (!schema) return 'Unknown tool';
  const props = schema.properties || {};
  for (const k of Object.keys(args)) {
    if (!Object.hasOwn(props, k)) return `Invalid tool arguments: unknown property '${k}'`;
  }
  const req = schema.required || [];
  for (const k of req) {
    if (!Object.hasOwn(args, k)) return `Invalid tool arguments: missing '${k}'`;
  }
  if (name === 'bhx_search_products') {
    if (typeof args.query !== 'string' || args.query.length < 1 || args.query.length > 100) return 'Invalid tool arguments: query';
    if (/[\p{Cc}\p{Cf}]/u.test(args.query)) return 'Invalid tool arguments: control chars in query';
    if (args.page_size !== undefined && ![10, 20, 50].includes(args.page_size)) return 'Invalid tool arguments: page_size enum';
    if (args.page_index !== undefined && (!Number.isInteger(args.page_index) || args.page_index < 0 || args.page_index > 40)) return 'Invalid tool arguments: page_index range';
  }
  if (name === 'bhx_get_product' && (!Number.isInteger(args.product_id) || args.product_id < 1)) return 'Invalid tool arguments: product_id';
  if (name === 'bhx_check_availability') {
    if (!Array.isArray(args.items) || args.items.length < 1 || args.items.length > 12) return 'Invalid tool arguments: items';
    for (const it of args.items) {
      if (!Number.isInteger(it?.product_id) || it.product_id < 1) return 'Invalid tool arguments: item.product_id';
      if (!Number.isInteger(it?.quantity) || it.quantity < 1 || it.quantity > 500) return 'Invalid tool arguments: item.quantity';
      if (it.max_unit_price_vnd !== undefined && (!Number.isInteger(it.max_unit_price_vnd) || it.max_unit_price_vnd < 1)) return 'Invalid tool arguments: item.max_unit_price_vnd';
    }
  }
  if (name === 'bhx_add_to_cart') {
    if (!Number.isInteger(args.product_id) || args.product_id < 1) return 'Invalid tool arguments: product_id';
    if (!Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 500) return 'Invalid tool arguments: quantity';
    if (!Number.isInteger(args.max_unit_price_vnd) || args.max_unit_price_vnd < 1) return 'Invalid tool arguments: max_unit_price_vnd';
    if (args.user_authorized !== true) return 'AUTHORIZATION_REQUIRED: bhx_add_to_cart requires user_authorized:true';
  }
  if (name === 'bhx_update_cart_item') {
    if (typeof args.line_id !== 'string' || args.line_id.length < 1 || args.line_id.length > 200) return 'Invalid tool arguments: line_id';
    if (!Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 500) return 'Invalid tool arguments: quantity';
    if (args.user_authorized !== true) return 'AUTHORIZATION_REQUIRED: bhx_update_cart_item requires user_authorized:true';
  }
  if (name === 'bhx_remove_cart_item') {
    if (typeof args.line_id !== 'string' || args.line_id.length < 1 || args.line_id.length > 200) return 'Invalid tool arguments: line_id';
    if (args.user_authorized !== true) return 'AUTHORIZATION_REQUIRED: bhx_remove_cart_item requires user_authorized:true';
  }
  if (name === 'bhx_select_address') {
    if (typeof args.address_id !== 'string' || !/^[1-9][0-9]{0,15}$/.test(args.address_id) || !Number.isSafeInteger(Number(args.address_id))) return 'Invalid tool arguments: address_id';
    if (args.user_authorized !== true) return 'AUTHORIZATION_REQUIRED: bhx_select_address requires user_authorized:true';
  }
  if (name === 'bhx_login_submit' && !/^[0-9]{4,8}$/.test(args.otp || '')) return 'Invalid tool arguments: otp';
  return null;
}

export function createHandler({ sessionFactory = createSession, loginFactory } = {}) {
  let initialized = false;
  let session = null;
  let login = null;
  let loginActive = false;

  const sess = () => { if (!session) session = sessionFactory({ chromiumPath: process.env.BHX_CHROMIUM_PATH }); return session; };
  const text = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
  const err = (code, msg) => ({ isError: true, content: [{ type: 'text', text: `${code}: ${msg}` }] });

  async function dispatch(name, args) {
    const s = sess();
    switch (name) {
      case 'bhx_auth_status': {
        const g = await s.cartState();
        const codeA = g.get?.ResultCode ?? g.getAfter?.ResultCode;
        const authed = codeA === 0;
        return text({ authenticated: authed, cart_lines_at_check: s.lines(g.get).length, observed_at: new Date().toISOString() });
      }
      case 'bhx_list_addresses': {
        const arr = await s.addresses();
        return text({ addresses: arr });
      }
      case 'bhx_get_delivery_context': {
        const ctx = await s.deliveryContext();
        return text({ ...ctx, observed_at: new Date().toISOString() });
      }
      case 'bhx_get_cart': {
        const st = await s.cartState();
        return text({ cart: st.get, cart_after: st.getAfter, correlated: st.correlated, observed_at: new Date().toISOString() });
      }
      case 'bhx_cart_summary': {
        const st = await s.cartState();
        const items = s.lines(st.get);
        const total = items.reduce((a, l) => a + (l.total_vnd || 0), 0);
        return text({ items, total, currency: 'VND', price_source: 'authenticated-cart-read', observed_at: new Date().toISOString() });
      }
      case 'bhx_search_products': {
        const r = await s.search({ query: args.query, pageIndex: args.page_index ?? 0, pageSize: args.page_size ?? 10 });
        return text({ products: r.items, pagination: r.pagination, price_status: 'catalog-observed-not-guaranteed-payable', observed_at: new Date().toISOString() });
      }
      case 'bhx_get_product': {
        const r = await s.search({ query: String(args.product_id), pageIndex: 0, pageSize: 10 });
        const hit = r.items.find((p) => p.id === args.product_id);
        if (!hit) return err('PRODUCT_NOT_FOUND', `product_id ${args.product_id} not present in id-string search`);
        return text({ ...hit, observed_at: new Date().toISOString() });
      }
      case 'bhx_check_availability': {
        const results = [];
        for (const it of args.items) {
          const rec = { product_id: it.product_id, quantity: it.quantity, status: 'failed', steps: [] };
          try {
            const added = await s.add({ product_id: it.product_id, quantity: it.quantity, max_unit_price_vnd: it.max_unit_price_vnd ?? Number.MAX_SAFE_INTEGER });
            rec.steps.push({ step: 'add', ok: true });
            rec.line = added.line;
            await s.remove({ line_id: added.line.line_id });
            rec.steps.push({ step: 'remove', ok: true });
            rec.status = 'purchasable_verified';
          } catch (e) {
            rec.error = String(e?.message || e).slice(0, 200);
          }
          results.push({ ...rec, cart_restored: rec.status === 'purchasable_verified' });
        }
        return text({ results, price_status: 'trial-cart-observed', observed_at: new Date().toISOString() });
      }
      case 'bhx_checkout_preview': {
        const r = await s.checkoutPreview();
        return text({ ...r, note: 'read-only preview; Đặt hàng never clicked' });
      }
      case 'bhx_add_to_cart': {
        const r = await s.add(args);
        return text({ line: r.line, preserved_other_lines: r.preserved_other_lines, observed_at: new Date().toISOString() });
      }
      case 'bhx_update_cart_item': {
        const before = await s.cartState();
        const exists = s.lines(before.get).find((l) => l.line_id === args.line_id);
        if (!exists) return err('LINE_NOT_FOUND', `line_id ${args.line_id} not present before update`);
        const r = await s.update({ line_id: args.line_id, quantity: args.quantity });
        return text({ line: r.line, observed_at: new Date().toISOString() });
      }
      case 'bhx_remove_cart_item': {
        const before = await s.cartState();
        const exists = s.lines(before.get).find((l) => l.line_id === args.line_id);
        if (!exists) return err('LINE_NOT_FOUND', `line_id ${args.line_id} not present before remove`);
        await s.remove({ line_id: args.line_id });
        return text({ removed: true, line_id: args.line_id, observed_at: new Date().toISOString() });
      }
      case 'bhx_select_address': {
        const r = await s.selectAddress({ address_id: args.address_id });
        return text(r);
      }
      case 'bhx_login_start': {
        if (loginActive) return err('LOGIN_IN_PROGRESS', 'window already open');
        login = (loginFactory || createLoginDefault)();
        const r = await login.start();
        if (r.status === 'otp_sent') { loginActive = true; return text(r); }
        login = null;
        return err('LOGIN_TRIGGER_FAILED', JSON.stringify(r));
      }
      case 'bhx_login_submit': {
        if (!loginActive || !login) return err('NOT_ACTIVE', 'call bhx_login_start first');
        const r = await login.submit(args.otp);
        loginActive = false;
        const keep = login; login = null;
        await keep.close().catch(() => {});
        if (r.status === 'logged_in') return text({ status: 'logged_in', verified: true });
        return err('LOGIN_NOT_VERIFIED', JSON.stringify(r));
      }
      default:
        return err('UNKNOWN_TOOL', `no handler for ${name}`);
    }
  }

  async function handle(m) {
    if (m.method === 'initialize') {
      initialized = true;
      return { protocolVersion: '2024-11-05', serverInfo: { name: 'bhx-mcp', version: '0.1.0' }, capabilities: { tools: {} } };
    }
    if (m.method === 'notifications/initialized') return;
    if (m.method === 'ping') return {};
    if (m.method === 'tools/list') {
      if (!initialized) throw { code: -32002, message: 'Server not initialized' };
      return { tools: TOOLS };
    }
    if (m.method === 'tools/call') {
      if (!initialized) throw { code: -32002, message: 'Server not initialized' };
      if (!Object.hasOwn(m, 'id')) return; // notification: no reply, no side effect
      const { name, arguments: args = {} } = m.params || {};
      const problem = argCheck(name, args);
      if (problem) throw { code: -32602, message: problem };
      if (loginActive && name !== 'bhx_login_submit' && name !== 'bhx_auth_status') return err('LOGIN_IN_PROGRESS', 'OTP relay window is open; finish bhx_login_submit or wait for expiry.');
      try {
        return await dispatch(name, args);
      } catch (e) {
        const msg = String(e?.message || e).slice(0, 300);
        if (/REQUIRES_LOGIN/.test(msg)) return err('REQUIRES_LOGIN', 'BHX session not active. Run bhx_login_start then bhx_login_submit with the OTP.');
        if (/ADDRESS_ENDPOINT_UNAVAILABLE/.test(msg)) return err('ADDRESS_ENDPOINT_UNAVAILABLE', msg);
        return err('BHX_ERROR', msg);
      }
    }
    throw { code: -32601, message: 'Method not found' };
  }

  return { handle, close: async () => { if (login) await login.close().catch(() => {}); if (session) await session.close().catch(() => {}); } };
}

function createLoginDefault() { return import('./auth.mjs').then((m) => m.createLogin()); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { handle, close } = createHandler();
  let queue = Promise.resolve();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', (line) => {
    queue = queue.then(async () => {
      let m;
      try { if (Buffer.byteLength(line) > 65536) throw new Error('line too long'); m = JSON.parse(line); }
      catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return; }
      try {
        const result = await handle(m);
        if (Object.hasOwn(m, 'id')) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n');
      } catch (e) {
        if (Object.hasOwn(m, 'id')) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: e.code || -32603, message: e.message || 'Internal error' } }) + '\n');
      }
    }).catch(() => {});
  });
  input.on('close', () => { void queue.then(close).catch(() => {}); });
}
