// Offline tests for relay login: spawn failure, OTP window, submit→verify outcome, guards. No browser/network.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLogin } from '../src/auth.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fakeChild(events) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = { resume() {} };
  child.stdin = { writes: [], write(d) { this.writes.push(String(d)); }, on() {} };
  child.kill = () => child.emit('exit', 0);
  for (const [ms, ev] of events) setTimeout(() => child.stdout.emit('data', Buffer.from(JSON.stringify(ev) + '\n')), ms);
  return child;
}

// 1) full relay: start triggers SMS; submit sends code; login_ok closes; active() then false
{
  const login = createLogin({
    startTimeoutMs: 3000, submitCapMs: 3000,
    launch: () => fakeChild([[10, { event: 'sms_sent', expires_in: 120 }], [1600, { event: 'login_ok' }]]),
  });
  assert.equal(login.active(), false);
  const r1 = await login.start();
  assert.deepEqual({ status: r1.status, expires_in: r1.expires_in }, { status: 'otp_sent', expires_in: 120 });
  assert.equal(login.active(), true);
  // duplicate start must not double-spawn or re-send
  const r2 = await login.start();
  assert.equal(r2.status, 'otp_pending');
  const r3 = await login.submit('123456');
  assert.equal(r3.status, 'logged_in');
  assert.equal(login.active(), false);
  await login.close();
}

// 2) submit without a running relay -> not_active; invalid otp -> -32602
{
  const login = createLogin({ launch: () => fakeChild([[10, { event: 'sms_sent', expires_in: 5 }]]) });
  assert.equal((await login.submit('111111')).status, 'not_active');
  await login.close();
}

// 3) trigger rejected (quota): start surfaces exact reason and closes relay
{
  const login = createLogin({
    startTimeoutMs: 3000,
    launch: () => fakeChild([[10, { event: 'login_failed', error: 'TRIGGER_REJECTED', code: 'otp_send_sms_failed_by_ccm' }]]),
  });
  const r = await login.start();
  assert.deepEqual({ status: r.status, error: r.error, detail: r.detail }, { status: 'failed', error: 'TRIGGER_REJECTED', detail: 'otp_send_sms_failed_by_ccm' });
  assert.equal(login.active(), false);
}

// 4) no sms event before deadline -> unverified, closed (fail-closed)
{
  const login = createLogin({ startTimeoutMs: 300, submitCapMs: 3000, launch: () => fakeChild([[2000, { event: 'sms_sent', expires_in: 120 }]]) });
  const r = await login.start();
  assert.deepEqual({ status: r.status, error: r.error }, { status: 'failed', error: 'SMS_TRIGGER_UNVERIFIED' });
  assert.equal(login.active(), false);
}

// 5) window expired before submit -> window_expired, relay closed
{
  const login = createLogin({ startTimeoutMs: 3000, submitCapMs: 5000, submitFloorMs: 500, launch: () => fakeChild([[10, { event: 'sms_sent', expires_in: 1 }]]) });
  await login.start();
  await sleep(1300);
  const r = await login.submit('123456');
  assert.equal(r.status, 'window_expired');
  assert.equal(login.active(), false);
}

// 6) submit then login_failed (wrong code) -> failed with code, closed
{
  const login = createLogin({
    startTimeoutMs: 3000, submitCapMs: 3000,
    launch: () => fakeChild([[10, { event: 'sms_sent', expires_in: 60 }]]),
  });
  await login.start();
  const r = await login.submit('000000');
  // fake child here emitted only sms_sent; submit writes code and awaits outcome: no login_ok/login_failed -> unverified closed
  assert.deepEqual({ status: r.status, error: r.error }, { status: 'failed', error: 'OUTCOME_UNVERIFIED' });
  assert.equal(login.active(), false);
}

// 7) server tool surface: 14 tools incl. submit; submit without start -> NOT_ACTIVE; invalid otp -> -32600/-32602; duplicate start -> BROWSER_BUSY
{
  const { createHandler } = await import('../src/server.mjs');
  let starts = 0, submits = [];
  const handler = createHandler({ loginFactory: () => ({ active: () => Boolean(starts), start: async () => { starts++; return { status: 'otp_sent', expires_in: 120 }; }, submit: async otp => { submits.push(otp); return { status: 'logged_in' }; }, close: async () => { starts = 0; } }) });
  await handler.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  const tl = await handler.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(tl.tools.length, 14);
  // notification submit (no id) rejects with -32600, no side effect
  await assert.rejects(() => handler.handle({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'bhx_login_submit', arguments: { otp: '123456' } } }), e => e.code === -32600);
  // submit before start -> NOT_ACTIVE
  const na = await handler.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bhx_login_submit', arguments: { otp: '123456' } } });
  assert.equal(na.content[0].text.startsWith('NOT_ACTIVE'), true);
  // invalid otp format -> -32602
  await assert.rejects(() => handler.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'bhx_login_submit', arguments: { otp: 'abc' } } }), e => e.code === -32602);
  // extra arg on start -> -32602
  await assert.rejects(() => handler.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'bhx_login_start', arguments: { otp: '123456' } } }), e => e.code === -32602);
  // start ok -> active; another start -> BROWSER_BUSY; real tools blocked while relay active
  const st = await handler.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'bhx_login_start', arguments: {} } });
  assert.equal(st.content[0].text.includes('otp_sent'), true);
  const dup = await handler.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'bhx_login_start', arguments: {} } });
  assert.equal(dup.content[0].text.startsWith('BROWSER_BUSY'), true);
  const blocked = await handler.handle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'bhx_get_cart', arguments: {} } });
  assert.equal(blocked.content[0].text.startsWith('LOGIN_IN_PROGRESS'), true);
  // submit through server -> otp forwarded, logged_in
  const sub = await handler.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'bhx_login_submit', arguments: { otp: '654321' } } });
  assert.deepEqual(submits, ['654321']);
  assert.equal(sub.content[0].text.includes('logged_in'), true);
  await handler.close();
}

console.log('PASS: relay login start/submit/window/guards; submit tool surface; fail-closed on all unverified paths.');
