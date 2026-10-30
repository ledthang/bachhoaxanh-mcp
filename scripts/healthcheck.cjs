// MCP stdio readiness probe: spawn server, send initialize -> tools/list, print counts, exit.
// Uses fs.writeSync so output is flushed before process.exit (piped stdout is buffered).
const { spawn } = require('child_process');
const fs = require('fs');
const out = (s) => fs.writeSync(1, s);
const p = spawn('node', ['src/server.mjs'], { stdio: ['pipe', 'pipe', 'ignore'] });
const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');

let buf = '';
p.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id === 1 && m.result) {
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    } else if (m.id === 2 && m.result) {
      const names = (m.result.tools || []).map((t) => t.name);
      out('mcp_tools_count: ' + names.length + '\n');
      out('checkout_or_payment_present: '
        + names.some((n) => /checkout|payment/.test(n)) + '\n');
      p.kill('SIGKILL');
      process.exit(names.length === 13 ? 0 : 1);
    }
  }
});
send({ jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {},
            clientInfo: { name: 'healthcheck', version: '1' } } });
setTimeout(() => { out('TIMEOUT\n'); p.kill('SIGKILL'); process.exit(1); }, 15000);
