// One held MCP server across the OTP window. Steps:
//  login_start -> real OTP SMS to the phone -> print WAITING
//  I then write /tmp/bhx_otp_input when the user pastes -> submit -> logged_in
//  then live add test: search 1 product -> add -> cart_summary must show the line.
// Waits up to 240s for the pasted OTP. Prints stage markers; polls externally.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const OTP_INPUT = '/tmp/bhx_otp_input';
rmSync(OTP_INPUT, { force: true });

const CHROME = '/home/openclaw/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const proc = spawn('node', ['src/server.mjs'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, BHX_PHONE: process.env.BHX_PHONE || '0969745020', BHX_CHROMIUM_PATH: process.env.BHX_CHROMIUM_PATH || CHROME },
});
let buf = ''; const lines = [];
proc.stdout.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); } });
proc.stderr.on('data', (d) => process.stderr.write(d));
const send = (o) => proc.stdin.write(JSON.stringify(o) + '\n');
let id = 0;
async function call(name, args = {}, timeoutMs = 90000) {
  const start = lines.length;
  send({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    for (let k = start; k < lines.length; k++) { try { const m = JSON.parse(lines[k]); if (m.id === id) return m; } catch {} }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { _timeout: true };
}
const text = (m) => (m?.result?.content || []).map((c) => c.text).join('') || JSON.stringify(m).slice(0, 400);

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
await new Promise((r) => setTimeout(r, 1200));
send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

const st = await call('bhx_login_start', {}, 120000);
console.log('STAGE login_start:', text(st).slice(0, 400));
if (!text(st).includes('otp_sent')) { console.log('NO OTP SENT — aborting'); proc.kill(); process.exit(1); }

console.log('STAGE WAITING for /tmp/bhx_otp_input (paste the OTP)');
let otp = null;
for (let waited = 0; waited < 240000; waited += 2000) {
  if (existsSync(OTP_INPUT)) { const v = readFileSync(OTP_INPUT, 'utf8').trim(); if (/^\d{4,8}$/.test(v)) { otp = v; break; } }
  await new Promise((r) => setTimeout(r, 2000));
}
if (!otp) { console.log('STAGE NO_OTP — window closed'); proc.kill(); process.exit(1); }

const sub = await call('bhx_login_submit', { otp }, 120000);
console.log('STAGE submit:', text(sub).slice(0, 300));
if (!text(sub).includes('logged_in')) { console.log('NOT LOGGED IN'); proc.kill(); process.exit(1); }

// live add verification
const sp = await call('bhx_search_products', { query: 'trứng gà', page_size: 5 });
let prods = []; try { prods = JSON.parse(text(sp)).products || []; } catch {}
console.log('SEARCH products:', prods.slice(0, 3).map((p) => ({ id: p.id, name: (p.name || '').slice(0, 40) })));
if (prods.length) {
  const p = prods[0];
  const add = await call('bhx_add_to_cart', { product_id: p.id, quantity: 1, max_unit_price_vnd: 200000, user_authorized: true });
  console.log('ADD:', text(add).slice(0, 400));
  const sum = await call('bhx_cart_summary', {});
  console.log('CART_AFTER:', text(sum).slice(0, 400));
}
proc.kill();
console.log('DONE');
