# Clean stdio MCP check: initialize, tools/list, auth, addresses, delivery, cart read. Waits for real responses.
import json
import subprocess
import time

proc = subprocess.Popen(
    ['node', 'src/server.mjs'],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
)

def send(payload):
    proc.stdin.write(json.dumps(payload) + '\n')
    proc.stdin.flush()

def recv_until(msg_id, deadline):
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            return None
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get('id') == msg_id:
            return msg
    return None

send({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
      'params': {'protocolVersion': '2024-11-05', 'capabilities': {},
                 'clientInfo': {'name': 'check', 'version': '1'}}})
init = recv_until(1, time.time() + 30)
print('initialize:', 'ok' if init and 'result' in init else init)
send({'jsonrpc': '2.0', 'method': 'notifications/initialized', 'params': {}})

send({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}})
tools = recv_until(2, time.time() + 30)
names = [t['name'] for t in (tools or {}).get('result', {}).get('tools', [])]
print('tools:', len(names))
print('checkout_or_payment_present:', any('checkout' in n or 'payment' in n for n in names))

for msg_id, name in ((3, 'bhx_auth_status'), (4, 'bhx_list_addresses'), (5, 'bhx_get_delivery_context'), (6, 'bhx_get_cart')):
    start = time.time()
    send({'jsonrpc': '2.0', 'id': msg_id, 'method': 'tools/call', 'params': {'name': name, 'arguments': {}}})
    reply = recv_until(msg_id, start + 180)
    if not reply:
        print(name, ': NO RESPONSE before deadline')
        continue
    text = ''.join(c.get('text', '') for c in reply.get('result', {}).get('content', []) if c.get('type') == 'text')
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        print(name, ':', text[:200])
        continue
    if name == 'bhx_auth_status':
        print('auth_status:', {k: data.get(k) for k in ('authenticated', 'session_status', 'requires_login')})
    elif name == 'bhx_list_addresses':
        addrs = data.get('addresses', [])
        print('addresses: %d selected=%s' % (len(addrs), sum(1 for a in addrs if a.get('selected'))))
    elif name == 'bhx_get_delivery_context':
        print('delivery: verified=%s store=%s province=%s ward=%s' % (
            data.get('verified'), data.get('store_id'), data.get('province_id'), data.get('ward_id')))
    else:
        items = data.get('items', data.get('cart', {}).get('items', []))
        print('cart: items=%d total=%s' % (len(items), data.get('total')))
        for item in items:
            print('  line: qty=%s unit=%s total=%s inactive=%s' % (item.get('quantity'), item.get('unit_price'), item.get('total'), item.get('inactive')))

proc.stdin.close()
try:
    proc.wait(timeout=20)
except subprocess.TimeoutExpired:
    proc.kill()
print('server_exit', proc.returncode)
