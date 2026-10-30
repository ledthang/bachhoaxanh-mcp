// Live stdio check: initialize -> tools/list -> a few real tool calls. Verifies the MCP works
// end-to-end against the parked SPA session (guest or member, decided by what comes back).
import { spawn } from 'node:child_process';
const p = spawn(process.execPath, ['src/server.mjs'], { cwd: process.cwd(), env: { ...process.env, BHX_CHROMIUM_PATH: process.env.BHX_CHROMIUM_PATH } });
const rl = await (await import('node:readline')).createInterface({ input: p.stdout });
const pending = new Map();
function send(id, method, params) { p.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...(id != null ? { id } : {}), method, ...(params ? { params } : {}) }) + '\n'); }
const lines = [];
rl.on('line', (l) => { lines.push(l); const m = JSON.parse(l); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
function request(id, method, params) { return new Promise((res) => { pending.set(id, res); send(id, method, params); }); }
const init = await request(1, 'initialize', { protocolVersion: '2024-11-05' });
send(null, 'notifications/initialized');
const tl = await request(2, 'tools/list', {});
const names = tl.result.tools.map((t) => t.name);
console.log('TOOLS', names.length, names.join(','));
for (const [n, args] of [['bhx_auth_status', {}], ['bhx_get_cart', {}], ['bhx_get_delivery_context', {}], ['bhx_list_addresses', {}], ['bhx_search_products', { query: 'ca chua', page_size: 10 }], ['bhx_checkout_preview', {}]]) {
  const r = await request(10, 'tools/call', { name: n, arguments: args });
  const txt = r.error ? `ERR ${r.error.code} ${r.error.message}` : (r.result?.content?.[0]?.text || '').slice(0, 300);
  console.log(`--- ${n} --- ${txt}`);
}
p.stdin.end();
