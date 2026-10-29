import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectCartRead } from './browser.mjs';
import { allowedRequest, projectCart, contextSnapshot, productUI } from '../scripts/cart-poc.mjs';
import { validateAdd, guardRequest as popupGuard } from '../scripts/cart-cycle.mjs';
import { validateRefresh } from '../scripts/cart-refresh.mjs';
import { trialLine, priceAccepted, acknowledgeAdd, drainPending, validateRemove, updateAllowed, classifyResponse, cleanupEligible } from '../scripts/cart-trial.mjs';
const ORIGIN = 'https://www.bachhoaxanh.com';
const API = 'https://api.bachhoaxanh.com';
const PREFIX = API + '/gw/cart/api/OrderV2/';
const PROFILE = API + '/gw/bhx-api-identity/api/v1/profile/full-profile';
const PRODUCT = ORIGIN + '/rau-sach/cai-ngot-tui-400gr';
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
const keys = (value, expected) => value && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const fail = () => { throw Error('BHX_MUTATION_UNVERIFIED'); };
export function validateMutation(name, args) {
  const fields = name === 'bhx_add_to_cart' ? ['product_id', 'quantity', 'max_unit_price_vnd', 'user_authorized'] : name === 'bhx_update_cart_item' ? ['line_id', 'quantity', 'user_authorized'] : name === 'bhx_remove_cart_item' ? ['line_id', 'user_authorized'] : null;
  if (!fields || !args || typeof args !== 'object' || Array.isArray(args) || !keys(args, fields) || args.user_authorized !== true) throw Error('Explicit user_authorized:true and exact arguments required');
  if (name === 'bhx_add_to_cart') {
    if (args.product_id !== 335195 || args.quantity !== 1 || !Number.isSafeInteger(args.max_unit_price_vnd) || args.max_unit_price_vnd < 1) throw Error('UNVERIFIED_SCOPE: only product 335195, variant 1, scenario 0, quantity 1');
  } else if (!id(args.line_id) || (name === 'bhx_update_cart_item' && args.quantity !== 2)) throw Error('UNVERIFIED_SCOPE: runtime-owned line only; update quantity 1 to 2 only');
}
export async function createCartSession({browserType, profileDirectory} = {}) {
  const directory = resolve(profileDirectory || process.env.BHX_PROFILE_DIR || join(process.env.BHX_RUNTIME_DIR || join(homedir(), '.local/share/bhx-mcp'), 'profile'));
  if (!(await stat(join(directory, 'Default'))).isDirectory()) fail();
  const chromium = browserType || (await import('playwright')).chromium;
  const updateMode = true, previewUpdate = false;
  const observedKeys = ['provinceId', 'districtId', 'wardId', 'storeId', 'cartId', 'guid', 'quantity', 'note'];
  let ceiling = 6900, publicLineId = null;
  let browser, page, profile, delivery, cart, baseline, snapshot, line, armed;
  let fatal = false, addSent = false, removeSent = false, restored = false, cleaning = false;
  const state = { reads: new WeakMap(), epoch: 0, sequence: 0, applied: 0, addVerified: false, contextUnchanged: true, unsafe: false,
    restartRequired: false, restartVerified: false };
  const pending = new Set();
  let phase = 'startup', failurePhase = null;
  const failed = failedPhase => { fatal = true; failurePhase ??= failedPhase; };
  const outcome = { add_sent: false, add_verified: false, price_accepted: false, remove_sent: false, restored_empty: false, cleanup_required: false,
    restart_persistence_verified: false };
  const check = value => {
    if (!profile || !delivery || !value) fail();
    const current = contextSnapshot(profile, value, delivery);
    if (snapshot && current !== snapshot) { state.contextUnchanged = false; fail(); }
    snapshot = current;
    if (baseline && value.CartId !== baseline.cartId) { state.contextUnchanged = false; fail(); }
  };
  const drain = () => drainPending(pending);
  const awaitState = async predicate => {
    const deadline = Date.now() + 20000;
    while (!predicate() && (!fatal || cleaning) && !state.unsafe && Date.now() < deadline) await page.waitForTimeout(100);
    await drain();
    if ((fatal && !cleaning) || state.unsafe || !predicate()) fail();
  };
  const removeExact = async () => {
    if (!cleanupEligible(state)) fail();
    check(cart);
    const currentLine = trialLine({ HttpCode: 200, ResultCode: 0, Value: cart }, line.QuantityInCart);
    if (currentLine.GuildId !== line.GuildId) fail();
    const row = page.locator(`div[data-product="335195"][data-code="${line.GuildId}"]`);
    await row.waitFor({ state: 'visible', timeout: 5000 });
    const closeIcon = row.locator('img[alt="close-icon"]');
    if (await row.count() !== 1 || await closeIcon.count() !== 1) fail();
    armed = 'Remove';
    await closeIcon.dispatchEvent('click');
    await page.waitForTimeout(500);
    if (!state.removeRequest) {
      const confirm = page.locator('button:visible').filter({ hasText: /^ĐỒNG Ý$/i });
      if (await confirm.count() !== 1 || !await confirm.isVisible()) fail();
      armed = 'Remove';
      await confirm.click({ timeout: 5000 });
      await page.waitForTimeout(700);
      if (!state.removeRequest) {
        const remove = page.locator('button:visible').filter({ hasText: /^Xóa$/ });
        if (await remove.count() !== 1) fail();
        await remove.click({ timeout: 5000 });
      }
    }
  };
  const verifyRestored = async () => {
    await awaitState(() => state.removeSucceeded);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
    await awaitState(() => restored);
  };
  const close = async () => { await browser?.close().catch(() => {}); };


  const openBrowser = async () => {
    browser = await chromium.launchPersistentContext(directory, {
      headless: process.env.BHX_HEADED !== '1', offline: true, serviceWorkers: 'block', viewport: { width: 1280, height: 900 },
      executablePath: process.env.BHX_CHROMIUM_PATH, timeout: 30000,
    });
    if(fatal){await close();fail();}
    page = await browser.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(10000);
    page.on('request', request => {
      if ([PREFIX + 'get', PREFIX + 'getAfter'].includes(request.url())) state.reads.set(request, {
        phase: state.removeSucceeded ? 'fresh' : state.addRequest ? 'trial' : 'baseline',
        epoch: state.epoch, sequence: ++state.sequence });
    });
    for (const old of browser.pages()) if (old !== page) await old.close();
    await browser.route('**/*', async route => {
      const q = route.request();
      try {
        const url = q.url();
        if (url === PREFIX + 'UpdateCartItem' && updateMode) {
          const raw = q.postData();
          const candidateKeys = previewUpdate ? Object.keys(JSON.parse(raw)) : observedKeys;
          const valid = !fatal && armed === 'Update' && q.method() === 'POST' &&
            q.frame() === page.mainFrame() && !q.isNavigationRequest() && page.url() === ORIGIN + '/gio-hang' &&
            /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(q.headers()['content-type'] || '') &&
            updateAllowed(raw, baseline, line, state, candidateKeys) &&
            (previewUpdate || keys(JSON.parse(raw), observedKeys));
          if (!valid) { failed('update_guard'); state.unsafe = true; await route.abort(); return; }
          check(cart);
          armed = null; state.updateObserved = true; state.epoch++;
          if (previewUpdate) {
            await route.abort();
            fail();
            outcome.update_preview_aborted = true;
          } else {
            state.updateRequest = q;
            outcome.update_sent = true;
            await route.continue();
          }
          return;
        }
        if (url === PREFIX + 'Add' || url === PREFIX + 'Remove') {
          const operation = url.endsWith('/Add') ? 'Add' : 'Remove';
          const valid = (!fatal || (cleaning && operation === 'Remove' && cleanupEligible(state))) && !state.unsafe && armed === operation && q.method() === 'POST' &&
            q.frame() === page.mainFrame() && !q.isNavigationRequest() &&
            /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(q.headers()['content-type'] || '') &&
            page.url() === (operation === 'Add' ? PRODUCT : ORIGIN + '/gio-hang') &&
            (operation === 'Add' ? !addSent && validateAdd(q.postData(), baseline) && q.postDataJSON().productType === 1 && q.postDataJSON().scenario === 0 :
              !removeSent && line && validateRemove(q.postData(), baseline, line.GuildId));
          if (!valid) { failed('mutation_guard'); state.unsafe = true; await route.abort(); return; }
          armed = null;
          state.epoch++;
          if (operation === 'Add') { addSent = true; state.addRequest = q; }
          else { removeSent = true; state.removeRequest = q; }
          await route.continue();
          return;
        }
        if (new URL(url).pathname === '/gw/Product/GetPopupProduct') {
          outcome.popup_observed = true;
          const popup = { failed: false, armed: armed === 'Add' && !addSent && !fatal, baseline };
          await popupGuard(route, popup, page.mainFrame());
          if (popup.failed) { failed('popup_guard'); state.unsafe = true; }
          return;
        }
        if (new URL(url).origin === API && new URL(url).pathname === '/gw/LocationV3/GetFull') {
          if(q.method()==='GET' && !new URL(url).search && q.frame()===page.mainFrame()) {await route.continue();return;}
        }
        if (url === PREFIX + 'getAfter') {
          if (q.frame() !== page.mainFrame() || state.unsafe || q.method() !== 'POST' || q.isNavigationRequest() || !validateRefresh(q.postData(), baseline)) fail();
          await route.continue(); return;
        }
        if (url === PREFIX + 'get') {
          const body = q.postDataJSON();
          if (!['provinceId','districtId','wardId','storeId'].every(key => Number.isSafeInteger(body[key]) &&
              (key === 'districtId' ? body[key] >= 0 : body[key] > 0) && (!baseline || body[key] === baseline[key]))) fail();
        }
        if ((fatal && !cleaning) || state.unsafe || q.frame() !== page.mainFrame() || !allowedRequest(url, q.method(), q.isNavigationRequest(), q.resourceType(), '/gio-hang')) {
          await route.abort();
        }
        else await route.continue();
      } catch { failed('request_guard'); state.unsafe = true; await route.abort().catch(() => {}); }
    });
    page.on('response', response => {
      const url = response.url();
      if (![PROFILE, PREFIX + 'get', PREFIX + 'getAfter', PREFIX + 'Add', PREFIX + 'Remove', ...(updateMode ? [PREFIX + 'UpdateCartItem'] : [])].includes(url)) return;
      let responsePhase = 'response_transport';
      const task = (async () => {
        const request = response.request();
        if (url !== PROFILE && classifyResponse(request, state) === 'ignore') return;
        if (!response.ok() || request.frame() !== page.mainFrame()) fail();
        responsePhase = 'response_json';
        const payload = await Promise.race([response.json(), new Promise((_, reject) => { const timer=setTimeout(()=>reject(Error('READ_TIMEOUT')),10000);timer.unref(); })]);
        if (url !== PROFILE && classifyResponse(request, state) === 'ignore') return;
        if (url === PROFILE) {
          responsePhase = 'profile_context';
          if (state.addRequest) {
            if (contextSnapshot(payload, cart, delivery) !== snapshot) fail();
          }
          profile = payload; state.profileVerified = true; return;
        }
        const kind = classifyResponse(request, state);
        if (kind === 'ignore') return;
        if (url === PREFIX + 'get') {
          responsePhase = 'read_context';
          const body = response.request().postDataJSON();
          const next = Object.fromEntries(['provinceId', 'districtId', 'wardId', 'storeId'].map(k => [k, body[k]]));
          if (delivery && JSON.stringify(delivery) !== JSON.stringify(next)) fail();
          delivery = next;
        }
        const next = payload?.Value;
        if (kind === 'add') {
          responsePhase = 'add_acknowledgement';
          acknowledgeAdd(payload, baseline);
          state.addAcknowledged = true;
          outcome.add_acknowledged = true;
          return;
        }
        if (kind === 'update') {
          responsePhase = 'update_acknowledgement';
          if (payload?.HttpCode !== 200 || payload?.ResultCode !== 0) fail();
          state.updateAcknowledged = true;
          return;
        }
        if (kind === 'baseline') {
          responsePhase = 'baseline_schema';
          if (baseline) check(next);
          projectCart(payload);
          if (!baseline && id(next?.CartId)) baseline = { ...delivery, cartId: next.CartId };
          cart = next;
        } else {
          responsePhase = kind + '_context';
          check(next);
          responsePhase = kind + '_schema';
          if (kind === 'trial') {
            const nextLine = trialLine(payload, state.updateRequest ? 2 : 1);
            if (line && line.GuildId !== nextLine.GuildId) fail();
            line = nextLine;
            state.line = line;
            if (!priceAccepted(line) || line.Price > ceiling || next.CartTotal.Total !== line.Total) failed('price_ceiling');
            cart = next;
            state.addVerified = true;
            outcome.add_verified = true;
            if (state.updateRequest) outcome.update_verified = true;
            if (state.updateObserved) state.updateReadVerified = true;
          } else if (kind === 'remove') {
            projectCart(payload);
            cart = next;
            state.removeSucceeded = true;
            state.epoch++;
          } else if (kind === 'fresh') {
            projectCart(payload);
            cart = next;
            restored = true;
          }
        }
        const read = state.reads.get(request);
        if (read) state.applied = read.sequence;
      })().catch(() => { outcome.response_failure ??= responsePhase; failed(responsePhase); state.unsafe = true; state.contextUnchanged = false; });
      pending.add(task); void task.finally(() => pending.delete(task));
    });
  };
  const refresh = async () => {
    state.epoch++;
    restored = false;
    const before = state.sequence;
    await page.goto(ORIGIN + '/gio-hang', { waitUntil: 'domcontentloaded' });
    await awaitState(() => state.applied > before);
    await page.waitForTimeout(2500);
    await drain(); check(cart);
  };
  let serial = Promise.resolve();
  return {
    close,
    async readCart() {
      await serial;
      if(fatal || !browser)fail();
      await refresh();
      return {...projectCartRead({HttpCode:200,ResultCode:0,Value:cart}),context:{verified:true,store_id:baseline.storeId,province_id:baseline.provinceId,ward_id:baseline.wardId},observed_at:new Date().toISOString()};
    },
    mutate(name, args) {
      const operation = serial.then(async () => {
        validateMutation(name, args);
        if (fatal || state.unsafe) fail();
        if (name !== 'bhx_add_to_cart' && (!publicLineId || args.line_id !== publicLineId)) throw Error('UNKNOWN_RUNTIME_LINE');
        const deadline=setTimeout(()=>{failed('timeout');state.unsafe=true;void close().catch(()=>{});},60000);
        try {
          if (!browser) {
            await openBrowser();
            await browser.setOffline(false);
            await page.goto(ORIGIN + '/tim-kiem?key=' + encodeURIComponent('cải ngọt'), { waitUntil: 'domcontentloaded' });
            await awaitState(() => profile && cart && delivery);
            check(cart);
            baseline = { ...delivery, cartId: cart.CartId };
            if (!id(baseline.cartId)) fail();
          }
          if (name === 'bhx_add_to_cart') {
            if (addSent) throw Error('UNVERIFIED_SCOPE: one Add per server session');
            ceiling = Math.min(args.max_unit_price_vnd, 6900);
            await refresh();
            projectCart({ HttpCode: 200, ResultCode: 0, Value: cart });
            await page.goto(PRODUCT, { waitUntil: 'domcontentloaded' });
            const handle = await page.waitForFunction(productUI, undefined, { timeout: 20000 }); await handle.dispose();
            await drain(); check(cart);
            if (page.url() !== PRODUCT || !(await page.evaluate(productUI))?.verified5000 || ceiling < 6900) throw Error('PRICE_UNVERIFIED: observed cart may charge 6900 VND');
            projectCart({ HttpCode: 200, ResultCode: 0, Value: cart });
            const purchase = page.locator('div.sticky').filter({ has: page.getByRole('heading', { name: 'Cải ngọt túi 400g', exact: true }) }).locator(':scope > div.px-9px > button').filter({ hasText: /^Mua$/ });
            if (await purchase.count() !== 1 || !await purchase.isEnabled()) fail();
            armed = 'Add'; await purchase.click({ timeout: 5000 });
            await awaitState(() => state.addAcknowledged);
            await refresh();
            if (!state.addVerified || !line || line.QuantityInCart !== 1) fail();
            publicLineId = randomUUID();
          } else {
            await refresh();
            const current = trialLine({ HttpCode: 200, ResultCode: 0, Value: cart }, line.QuantityInCart);
            if (current.GuildId !== line.GuildId || !state.contextUnchanged) fail();
            if (name === 'bhx_update_cart_item') {
              if (line.QuantityInCart !== 1 || state.updateObserved) throw Error('UNVERIFIED_SCOPE: only quantity 1 to 2');
              const row = page.locator(`div[data-product="335195"][data-code="${line.GuildId}"]`);
              const plus = row.locator('img[alt="plus"]');
              if (await row.count() !== 1 || await plus.count() !== 1) fail();
              await page.waitForTimeout(2500);
              armed = 'Update'; await plus.locator('..').dispatchEvent('click');
              await page.waitForTimeout(1500);
              await awaitState(() => state.updateAcknowledged);
              state.updateReadVerified = false;
              await refresh();
              if (!state.updateReadVerified || line.QuantityInCart !== 2) fail();
            } else {
              await removeExact();
              await awaitState(() => state.removeSucceeded);
              await refresh();
              if (!restored) fail();
              publicLineId = null;
            }
          }
          if (fatal || state.unsafe) fail();
          return { verified: true, operation: name, items: publicLineId ? [{ line_id: publicLineId, product_id: 335195, quantity: line.QuantityInCart, unit_price_vnd: line.Price, total_vnd: line.Total }] : [], observed_at: new Date().toISOString() };
        } catch {
          if(process.env.BHX_DIAGNOSTICS==='1')console.error(JSON.stringify({failurePhase,unsafe:state.unsafe,updateObserved:!!state.updateObserved,updateAcknowledged:!!state.updateAcknowledged,quantity:line?.QuantityInCart}));
          fatal = true; armed = null;
          throw Error('BHX_MUTATION_UNVERIFIED: operation may have applied; no retry or automatic cleanup. Inspect cart before further action.');
        } finally { clearTimeout(deadline);armed = null;if(fatal)await close(); }
      });
      serial = operation.catch(() => {});
      return operation;
    }
  };
}
