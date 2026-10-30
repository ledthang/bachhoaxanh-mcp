import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Relay login: detached headless child + file transport under the profile dir,
// so the relay survives MCP server restarts and spans chat turns.
// relay.log carries JSON events; otp.code carries the relayed code (0600).
export function createLogin({ launch = spawn, startTimeoutMs = 85000, waitOutcomeMs = 60000, pollMs = 1000 } = {}) {
  const dir = () => process.env.BHX_PROFILE_DIR || join(process.env.HOME || '/home/openclaw', '.local/share/bhx-mcp');
  const P = (...parts) => join(dir(), ...parts);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const read = async path => { try { return await readFile(path, 'utf8'); } catch { return ''; } };
  function relayPid() {
    try { const n = Number(readFileSync(P('relay.pid'), 'utf8').trim()); return Number.isSafeInteger(n) && n > 0 ? n : 0; } catch { return 0; }
  }
  function alive() { const n = relayPid(); if (!n) return false; try { process.kill(n, 0); return true; } catch { return false; } }
  function kill() { const n = relayPid(); if (!n) return; try { process.kill(n, 'SIGTERM'); } catch { /* already gone */ } }
  async function waitAny(markers, ms) {
    for (let waited = 0; waited < ms; waited += pollMs) {
      const log = await read(P('relay.log'));
      for (const marker of markers) if (log.includes(marker)) return marker;
      await sleep(pollMs);
    }
    return null;
  }
  function lastLine(marker) {
    try {
      const lines = readFileSync(P('relay.log'), 'utf8').split('\n').filter(l => l.includes(marker));
      if (!lines.length) return null;
      try { return JSON.parse(lines[lines.length - 1]); } catch { return null; }
    } catch { return null; }
  }
  return {
    active: () => alive(),
    async start() {
      if (alive()) return { status: 'otp_pending', note: 'relay already running; send the code, it will be picked up' };
      try {
        await mkdir(dir(), { recursive: true, mode: 0o700 });
        await rm(P('otp.code'), { force: true });
        const fd = await open(P('relay.log'), 'w');
        const child = launch(process.execPath, [fileURLToPath(new URL('../scripts/login.mjs', import.meta.url))], { detached: true, stdio: ['ignore', fd.fd, fd.fd] });
        await writeFile(P('relay.pid'), String(child.pid));
        child.unref();
        await fd.close();
      } catch { return { status: 'failed', error: 'SPAWN_FAILED' }; }
      const hit = await waitAny(['"event":"sms_sent"', '"event":"login_failed"'], startTimeoutMs);
      if (hit === '"event":"sms_sent"') {
        const ev = lastLine('"event":"sms_sent"');
        return { status: 'otp_sent', expires_in: ev?.expires_in ?? null, note: 'check SMS; reply the digits here, the detached browser still waits on otp.code' };
      }
      if (hit === '"event":"login_failed"') {
        const ev = lastLine('"event":"login_failed"');
        kill();
        return { status: 'failed', error: ev?.error ?? 'UNKNOWN', detail: ev?.detail ?? null };
      }
      kill();
      return { status: 'failed', error: 'SMS_TRIGGER_UNVERIFIED' };
    },
    async submit(otp) {
      if (!alive()) return { status: 'not_active', note: 'run bhx_login_start first' };
      try { await writeFile(P('otp.code'), `${otp}\n`, { mode: 0o600 }); } catch { return { status: 'failed', error: 'CODE_WRITE_FAILED' }; }
      const hit = await waitAny(['"event":"login_ok"', '"event":"login_failed"'], waitOutcomeMs);
      if (hit === '"event":"login_ok"') { kill(); return { status: 'logged_in' }; }
      if (hit === '"event":"login_failed"') {
        const ev = lastLine('"event":"login_failed"');
        kill();
        return { status: 'failed', error: ev?.error ?? 'UNKNOWN', detail: ev?.detail ?? null };
      }
      kill();
      return { status: 'failed', error: 'OUTCOME_UNVERIFIED' };
    },
    async close() { kill(); },
  };
}
