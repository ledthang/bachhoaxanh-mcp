// Offline tests for relay login (file transport). The relay child is a REAL process (sleep)
// so alive() (process.kill(pid,0)) behaves exactly like production; events are appended to
// relay.log on a schedule to mimic the detached relay's JSON stream. No browser/network.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFile } from 'node:fs/promises';
import { createLogin } from '../src/auth.mjs';

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'bhx-relay-'));
  process.env.BHX_PROFILE_DIR = dir;
  return dir;
}
// launch real sleep as relay, append scheduled events to relay.log under the sandbox
function relayLaunch(events) {
  return (execPath, args, opts) => {
    const child = spawn('sleep', ['30'], { ...opts });
    for (const [ms, ev] of events) setTimeout(() => appendFile(join(process.env.BHX_PROFILE_DIR, 'relay.log'), JSON.stringify(ev) + '\n').catch(() => {}), ms);
    return child;
  };
}
const fast = { pollMs: 50 };
// relay close is async signal delivery; poll until the pid is really gone
const waitInactive = async (login, ms = 2000) => {
  for (let t = 0; t < ms; t += 50) { if (!login.active()) return true; await new Promise(r => setTimeout(r, 50)); }
  return !login.active();
};

// 1) happy path: sms_sent -> otp_sent; submit -> login_ok -> logged_in; active false after.
{
  const dir = sandbox();
  const login = createLogin({ startTimeoutMs: 2000, waitOutcomeMs: 2000, ...fast, launch: relayLaunch([[50, { event: 'sms_sent', expires_in: 120 }]]) });
  assert.equal(login.active(), false);
  assert.deepEqual(await login.start(), { status: 'otp_sent', expires_in: 120, note: 'check SMS; reply the digits here, the detached browser still waits on otp.code' });
  assert.equal(login.active(), true);
  assert.deepEqual(await login.start(), { status: 'otp_pending', note: 'relay already running; send the code, it will be picked up' });
  // schedule login_ok right after submit writes otp.code
  const subP = (async () => { await new Promise(r => setTimeout(r, 120)); await appendFile(join(dir, 'relay.log'), JSON.stringify({ event: 'login_ok' }) + '\n'); })();
  const r3 = await login.submit('123456');
  assert.deepEqual(r3, { status: 'logged_in' });
  assert.ok(await waitInactive(login));
  await subP;
}

// 2) trigger rejected: exact reason surfaces, relay closed (not active).
{
  sandbox();
  const login = createLogin({ startTimeoutMs: 2000, ...fast, launch: relayLaunch([[50, { event: 'login_failed', error: 'TRIGGER_REJECTED', detail: 'otp_send_sms_failed_by_ccm' }]]) });
  assert.deepEqual(await login.start(), { status: 'failed', error: 'TRIGGER_REJECTED', detail: 'otp_send_sms_failed_by_ccm' });
  assert.ok(await waitInactive(login));
}

// 3) no event before deadline -> unverified, closed (fail-closed).
{
  const dir = sandbox();
  const child = spawn('sleep', ['30']);
  const login = createLogin({ startTimeoutMs: 400, ...fast, launch: () => child });
  const r = await login.start();
  assert.deepEqual({ status: r.status, error: r.error }, { status: 'failed', error: 'SMS_TRIGGER_UNVERIFIED' });
  assert.ok(await waitInactive(login)); // start kills the relay on every failure path
  await login.close();
  assert.ok(await waitInactive(login));
  void dir;
}

// 4) window expires before submit -> window_expired semantics: submit still waits full
//    outcome window then fails closed OUTCOME_UNVERIFIED (the 120s countdown is the relay's).
{
  sandbox();
  const login = createLogin({ startTimeoutMs: 2000, waitOutcomeMs: 500, ...fast, launch: relayLaunch([[50, { event: 'sms_sent', expires_in: 1 }]]) });
  assert.equal((await login.start()).status, 'otp_sent');
  assert.deepEqual(await login.submit('123456'), { status: 'failed', error: 'OUTCOME_UNVERIFIED' });
  assert.ok(await waitInactive(login));
}

// 5) spawn failure -> SPAWN_FAILED, no hang.
{
  sandbox();
  const login = createLogin({ startTimeoutMs: 1000, ...fast, launch: () => { throw new Error('boom'); } });
  assert.deepEqual(await login.start(), { status: 'failed', error: 'SPAWN_FAILED' });
  assert.equal(login.active(), false); // no child ever launched
}

// 6) server surface: 15 tools incl. relay pair; submit is request-only (notification -> no
//    reply, no side effect); submit without active relay -> NOT_ACTIVE; bad otp -> -32602;
//    real tools gated while relay active; submit -> logged_in -> ungated.
{
  const { createHandler } = await import('../src/server.mjs');
  let active = false; const submitted = [];
  const fakeSession = () => ({ async cartState() { const p = { Value: { GroupSOStep2InCart: [], CartTotal: { Total: 0 } } }; return { get: p, getAfter: p, correlated: true }; }, lines: () => [], async close() {} });
  const handler = createHandler({
    sessionFactory: fakeSession,
    loginFactory: () => ({
      active: () => active,
      start: async () => { if (active) return { status: 'otp_pending', note: 'relay already running; send the code, it will be picked up' }; active = true; return { status: 'otp_sent', expires_in: 120 }; },
      submit: async (otp) => { if (!active) return { status: 'not_active', note: 'run bhx_login_start first' }; submitted.push(otp); active = false; return { status: 'logged_in' }; },
      close: async () => { active = false; },
    }),
  });
  await handler.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  const tl = await handler.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(tl.tools.length, 15);
  assert.ok(tl.tools.some((t) => t.name === 'bhx_login_submit'));
  // notification submit: no id -> undefined reply, no relay touch
  const noid = await handler.handle({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'bhx_login_submit', arguments: { otp: '123456' } } });
  assert.ok(!noid);
  assert.deepEqual(submitted, []);
  // submit with no active relay -> NOT_ACTIVE
  const na = await handler.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bhx_login_submit', arguments: { otp: '123456' } } });
  assert.ok(na.isError && na.content[0].text.startsWith('NOT_ACTIVE'));
  // bad otp -> -32602
  await assert.rejects(() => handler.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'bhx_login_submit', arguments: { otp: 'abc' } } }), (e) => e.code === -32602);
  // start -> active; duplicate -> still otp_pending (no double-spawn); real tools gated
  assert.equal(JSON.parse((await handler.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'bhx_login_start', arguments: {} } })).content[0].text).status, 'otp_sent');
  const dup = await handler.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'bhx_login_start', arguments: {} } });
  assert.ok(dup.isError && dup.content[0].text.startsWith('LOGIN_IN_PROGRESS'));
  const blocked = await handler.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'bhx_get_cart', arguments: {} } });
  assert.ok(blocked.isError && blocked.content[0].text.startsWith('LOGIN_IN_PROGRESS'));
  assert.deepEqual(submitted, []);
  // submit -> logged_in, ungated
  const sub = await handler.handle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'bhx_login_submit', arguments: { otp: '654321' } } });
  assert.equal(JSON.parse(sub.content[0].text).status, 'logged_in');
  assert.deepEqual(submitted, ['654321']);
  const ok2 = await handler.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'bhx_cart_summary', arguments: {} } });
  assert.notEqual(JSON.parse(ok2.content[0].text).status, 'LOGIN_IN_PROGRESS');
  await handler.close();
}

console.log('PASS: relay login (file transport) start/submit/window/guards; surface 15; submit request-only; fail-closed on all unverified paths.');
