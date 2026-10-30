import { stat, readFile, writeFile } from 'node:fs/promises';
import { validateRefresh } from './cart-refresh.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { profileDirectory } from '../src/profile.mjs';
import { allowedRequest, projectCart, contextSnapshot, productUI } from './cart-poc.mjs';
import { validateAdd, guardRequest as popupGuard } from './cart-cycle.mjs';

const ORIGIN = 'https://www.bachhoaxanh.com';
const API = 'https://api.bachhoaxanh.com';
const PREFIX = API + '/gw/cart/api/OrderV2/';
const PROFILE = API + '/gw/bhx-api-identity/api/v1/profile/full-profile';
const PRODUCT = ORIGIN + '/rau-sach/cai-ngot-tui-400gr';
const keys = (x, expected) => x && typeof x === 'object' && !Array.isArray(x) &&
  Object.keys(x).length === expected.length && expected.every(k => Object.hasOwn(x, k));
const id = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(x);
const fail = () => { throw Error('TRIAL_STOP'); };

export function trialLine(payload, expectedQuantity = 1) {
  if (![1, 2].includes(expectedQuantity)) fail();
  if (payload?.HttpCode !== 200 || payload?.ResultCode !== 0) fail();
  const cart = payload.Value;
  if (!cart || !Number.isSafeInteger(cart.CartTotal?.Total) || cart.CartTotal.Total < 0 || (cart.GroupSOStep2InCart !== null && !Array.isArray(cart.GroupSOStep2InCart))) fail();
  const groups = [...(cart.GroupSOStep2InCart || [])];
  if (cart.GroupCartOff != null) groups.push(cart.GroupCartOff);
  if (groups.some(group => !group || !Array.isArray(group.ListCartItemBuy))) fail();
  const lines = groups.flatMap(group => group.ListCartItemBuy);
  if (lines.length !== 1) fail();
  const line = lines[0];
  if (line.Id !== 335195 || line.QuantityInCart !== expectedQuantity || !id(line.GuildId) ||
      ![0,1].includes(cart.TotalItemShow) || line.NetUnitValue !== 0 || line.IsGift ||
      [line, ...groups].some(owner => ['ListOfChildProduct', 'ListGift', 'ListAttachProduct'].some(key =>
        owner[key] != null && (!Array.isArray(owner[key]) || owner[key].length)))) fail();
  const empty = structuredClone(payload);
  Object.assign(empty.Value, { GroupSOStep2InCart: [], GroupCartOff: null, TotalItemShow: 0,
    CartTotal: { ...cart.CartTotal, Total: 0 } });
  projectCart(empty);
  return line;
}

export function priceAccepted(line) {
  return [1, 2].includes(line.QuantityInCart) && Number.isSafeInteger(line.Price) && line.Price > 0 && line.Price <= 6900 && line.Total === line.Price * line.QuantityInCart;
}

export function validateUpdate(raw, baseline, guid, observedKeys = []) {
  try {
    if (typeof raw !== 'string' || raw.length > 4096 || !baseline || !id(guid)) return false;
    const names = [...raw.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(match => JSON.parse(match[1]));
    const body = JSON.parse(raw);
    const required = ['provinceId', 'districtId', 'wardId', 'storeId', 'cartId', 'guid', 'quantity', 'note'];
    const optional = ['netUnitValue', ...['token', 'us'].filter(key => observedKeys.includes(key))];
    return names.length === new Set(names).size && keys(body, [...required, ...optional.filter(key => Object.hasOwn(body, key))]) &&
      ['provinceId', 'districtId', 'wardId', 'storeId'].every(key => Number.isSafeInteger(body[key]) &&
        (key === 'districtId' ? body[key] >= 0 : body[key] > 0) && body[key] === baseline[key]) &&
      id(baseline.cartId) && body.cartId === baseline.cartId && body.guid === guid && body.quantity === 2 && body.note === '' &&
      (!Object.hasOwn(body, 'netUnitValue') || body.netUnitValue === 0) &&
      ['token', 'us'].every(key => !Object.hasOwn(body, key) || typeof body[key] === 'string');
  } catch { return false; }
}

export function updateAllowed(raw, baseline, line, state, observedKeys) {
  return Boolean(state.addVerified && state.contextUnchanged && !state.unsafe && !state.updateObserved &&
    !state.removeRequest && line?.Id === 335195 && line.QuantityInCart === 1 &&
    validateUpdate(raw, baseline, line.GuildId, observedKeys));
}

export function recordPrice(outcome, line) {
  if (!priceAccepted(line)) outcome.price_rejected_once = true;
  outcome.price_accepted = priceAccepted(line) && !outcome.price_rejected_once;
  return outcome.price_accepted;
}

export function acknowledgeAdd(payload, baseline) {
  if (payload?.HttpCode !== 200 || payload?.ResultCode !== 0 ||
      !id(baseline?.cartId) || payload.Value?.CartId !== baseline.cartId) fail();
}

export async function drainPending(pending) {
  while (pending.size) await Promise.allSettled([...pending]);
}

export function trialFailed(fatal, outcome) {
  return Boolean(fatal || !outcome.restored_empty || !outcome.price_accepted || outcome.price_rejected_once);
}

export function validateRemove(raw, baseline, guid) {
  try {
    if (typeof raw !== 'string' || raw.length > 4096) return false;
    const names = [...raw.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(match => JSON.parse(match[1]));
    if (names.length !== 14 || new Set(names).size !== 13 || names.filter(key => key === 'wardId').length !== 2) return false;
    const body = JSON.parse(raw);
    return keys(body, ['token', 'us', 'provinceId', 'districtId', 'wardId', 'storeId', 'isNewModel', 'data']) &&
    ['provinceId', 'districtId', 'wardId', 'storeId'].every(k => Number.isSafeInteger(body[k]) && (k === 'districtId' ? body[k] >= 0 : body[k] > 0) && body[k] === baseline[k]) &&
    typeof body.token === 'string' && typeof body.us === 'string' && body.isNewModel === true &&
    keys(body.data, ['cartId', 'guid', 'reloadShiping', 'isSubmitOrder', 'productId', 'wardId']) &&
    body.data.wardId === baseline.wardId && id(baseline.cartId) && body.data.cartId === baseline.cartId && body.data.guid === guid && id(guid) &&
    body.data.productId === 335195 && body.data.reloadShiping === true && body.data.isSubmitOrder === false;
  } catch { return false; }
}

export function classifyResponse(request, state) {
  if (request === state.updateRequest) return state.removeRequest ? 'ignore' : 'update';
  if (request === state.addRequest) return state.removeRequest ? 'ignore' : 'add';
  if (request === state.removeRequest) return state.removeSucceeded ? 'ignore' : 'remove';
  const read = state.reads.get(request);
  if (!read || read.epoch !== state.epoch || read.sequence < state.applied) return 'ignore';
  const phase = read.phase;
  if (phase === 'baseline' && !state.addRequest) return 'baseline';
  if (phase === 'trial' && state.addRequest && !state.removeRequest) return 'trial';
  if (phase === 'fresh' && state.removeSucceeded) return 'fresh';
  return 'ignore';
}

export function cleanupEligible(state) {
  return Boolean(state.addVerified && state.line && state.contextUnchanged && !state.removeRequest && !state.unsafe &&
    (!state.restartRequired || state.restartVerified));
}

export async function main() {
  const args = process.argv.slice(2);
  const updateMode = ['--approved-update-trial', '--preview-update'].includes(args[0]);
  const explicitPreview = args.includes('--preview-update');
  if (!(args.length === 1 && (args[0] === '--approved-trial' || updateMode) ||
      args.length === 2 && args[0] === '--approved-update-trial' && args[1] === '--preview-update') || !process.env.DISPLAY) fail();
  process.umask(0o077);
  const schemaPath = resolve('data/cart-update-schema.json');
  let observedKeys = null;
  if (updateMode) {
    try {
      const saved = JSON.parse(await readFile(schemaPath, 'utf8'));
      if (saved.endpoint === PREFIX + 'UpdateCartItem' && Array.isArray(saved.keys) &&
          saved.keys.every(key => typeof key === 'string')) observedKeys = saved.keys;
    } catch (error) { if (error.code !== 'ENOENT') fail(); }
  }
  const previewUpdate = updateMode && (explicitPreview || !observedKeys);
  const directory = profileDirectory();
  if (!directory.startsWith(homedir() + '/') || !(await stat(join(directory, 'Default'))).isDirectory()) fail();
  const { chromium } = await import('playwright');
  let browser, page, profile, delivery, cart, baseline, snapshot, line, armed;
  let fatal = false, addSent = false, removeSent = false, restored = false, cleaning = false;
  const state = { reads: new WeakMap(), epoch: 0, sequence: 0, applied: 0, addVerified: false, contextUnchanged: true, unsafe: false,
    restartRequired: updateMode && !previewUpdate, restartVerified: false };
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
  const close = () => browser?.close();
  const timer = setTimeout(() => { failed('timeout'); void close()?.catch(() => {}); }, 150000);
  const openBrowser = async () => {
    browser = await chromium.launchPersistentContext(directory, {
      headless: false, serviceWorkers: 'block', viewport: { width: 1280, height: 900 },
      executablePath: process.env.BHX_CHROMIUM_PATH,
    });
    page = await browser.newPage();
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
            await writeFile(schemaPath, JSON.stringify({ endpoint: url, keys: candidateKeys }) + '\n', { mode: 0o600 });
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
        const payload = await response.json();
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
            if (!recordPrice(outcome, line)) failed('trial_price');
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
  try {
    await openBrowser();
    phase = 'baseline_navigation';
    await page.goto(ORIGIN + '/tim-kiem?key=' + encodeURIComponent('cải ngọt'), { waitUntil: 'domcontentloaded' });
    phase = 'baseline_verification';
    await awaitState(() => profile && cart && delivery);
    check(cart);
    baseline = { ...delivery, cartId: cart.CartId };
    if (!id(baseline.cartId)) fail();
    phase = 'product_navigation';
    await page.goto(PRODUCT, { waitUntil: 'domcontentloaded' });
    phase = 'product_ui';
    const handle = await page.waitForFunction(productUI, undefined, { timeout: 20000 }); await handle.dispose();
    await drain(); check(cart);
    if (page.url() !== PRODUCT || !(await page.evaluate(productUI))?.verified5000) fail();
    const purchase = page.locator('div.sticky').filter({ has: page.getByRole('heading', { name: 'Cải ngọt túi 400g', exact: true }) }).locator(':scope > div.px-9px > button').filter({ hasText: /^Mua$/ });
    if (await purchase.count() !== 1 || !await purchase.isEnabled()) fail();
    projectCart({ HttpCode: 200, ResultCode: 0, Value: cart });
    if (fatal || state.unsafe) fail();
    if (!validateRemove(JSON.stringify({ token: '', us: '', ...delivery, isNewModel: true,
      data: { cartId: baseline.cartId, guid: 'contract-check', reloadShiping: true,
        isSubmitOrder: false, productId: 335195, wardId: baseline.wardId } }), baseline, 'contract-check')) fail();
    phase = 'add_click';
    armed = 'Add'; await purchase.click({ timeout: 5000 });
    phase = 'add_acknowledgement';
    await awaitState(() => state.addAcknowledged);
    phase = 'cart_navigation';
    await page.goto(ORIGIN + '/gio-hang', { waitUntil: 'domcontentloaded' });
    phase = 'trial_verification';
    await awaitState(() => Boolean(line)); outcome.add_verified = true;
    await drain(); check(cart);
    if (updateMode) {
      phase = 'update_ui';
      await page.goto(ORIGIN + '/gio-hang', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      await drain(); check(cart);
      const row = page.locator(`div[data-product="335195"][data-code="${line.GuildId}"]`);
      const plus = row.locator('img[alt="plus"]');
      if (await row.count() !== 1 || await plus.count() !== 1) fail();
      await page.waitForTimeout(2500);
      phase = 'update_click';
      armed = 'Update';
      await plus.locator('..').dispatchEvent('click');
      phase = 'update_acknowledgement';
      await page.waitForTimeout(1500);
      await awaitState(() => previewUpdate ? outcome.update_preview_aborted : state.updateAcknowledged);
      phase = 'update_verification';
      state.epoch++;
      state.updateReadVerified = false;
      outcome.update_verified = false;
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
      await awaitState(() => state.updateReadVerified && (previewUpdate ? state.line?.QuantityInCart === 1 : outcome.update_verified));
      await drain(); check(cart);
      if (!previewUpdate) {
        phase = 'restart_close';
        armed = null;
        state.epoch++;
        await close();
        await drain();
        if (fatal || state.unsafe) fail();
        phase = 'restart_navigation';
        state.epoch++;
        state.reads = new WeakMap();
        state.updateReadVerified = false;
        state.profileVerified = false;
        outcome.update_verified = false;
        await openBrowser();
        await page.goto(ORIGIN + '/gio-hang', { waitUntil: 'domcontentloaded', timeout: 10000 });
        phase = 'restart_verification';
        await awaitState(() => state.profileVerified && state.updateReadVerified && outcome.update_verified && state.line?.QuantityInCart === 2);
        await drain(); check(cart);
        state.restartVerified = true;
        outcome.restart_persistence_verified = true;
      }
    }
    phase = 'remove_ui';
    await page.goto(ORIGIN + '/gio-hang', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await drain(); check(cart);
    await removeExact();
    phase = 'restore_verification';
    await verifyRestored();
    await drain();
  } catch { failed(phase); outcome.main_failure_phase = phase; }
  finally {
    armed = null;
    await drain();
    let cleanupTimer;
    try {
      if (!restored && state.addVerified && state.contextUnchanged && !state.unsafe &&
          (!state.restartRequired || state.restartVerified)) {
        cleaning = true;
        await Promise.race([(async () => {
          if (!state.removeRequest) {
            await page.goto(ORIGIN + '/gio-hang', { waitUntil: 'domcontentloaded', timeout: 10000 });
            check(cart);
            await removeExact();
          }
          await verifyRestored();
        })(), new Promise((_, reject) => {
          cleanupTimer = setTimeout(() => {
            cleaning = false; state.unsafe = true; armed = null;
            reject(Error('CLEANUP_TIMEOUT'));
          }, 25000);
        })]);
      }
    } catch { failed('cleanup'); outcome.cleanup_failure_phase = 'cleanup'; }
    finally { cleaning = false; armed = null; clearTimeout(cleanupTimer); clearTimeout(timer); }
    await drain();
    try { await close(); } catch { failed('browser_close'); }
    await drain();
    Object.assign(outcome, { add_sent: addSent, remove_sent: removeSent, restored_empty: restored,
      cleanup_required: addSent && !restored });
    console.log(JSON.stringify({...outcome, failure_phase: failurePhase}));
    if (trialFailed(fatal, outcome)) process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
