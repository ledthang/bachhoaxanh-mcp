#!/usr/bin/env python3
"""One stdio session: list -> select the NON-selected address -> print the RAW
select response and the resulting context, to see why selection does not apply.
Cart is empty (verified) so selection is permitted."""
import json, subprocess, time

proc = subprocess.Popen(['node', 'src/server.mjs'], stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)


def send(o):
    proc.stdin.write(json.dumps(o) + '\n')
    proc.stdin.flush()


def recv(msg_id, dl):
    while time.time() < dl:
        line = proc.stdout.readline()
        if not line:
            return None
        try:
            m = json.loads(line)
        except json.JSONDecodeError:
            continue
        if m.get('id') == msg_id:
            return m
    return None


def call(name, args, dl=170):
    global _id
    _id += 1
    send({'jsonrpc': '2.0', 'id': _id, 'method': 'tools/call',
          'params': {'name': name, 'arguments': args}})
    r = recv(_id, time.time() + dl)
    if not r:
        return {'_err': 'NO_RESPONSE'}
    res = r.get('result', {})
    txt = ''.join(c.get('text', '') for c in res.get('content', []) if c.get('type') == 'text')
    try:
        return {'_isError': res.get('isError', False), 'data': json.loads(txt)}
    except Exception:
        return {'_isError': res.get('isError', False), '_raw': txt[:300]}


_id = 0
send({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
      'params': {'protocolVersion': '2024-11-05', 'capabilities': {},
                 'clientInfo': {'name': 'switch', 'version': '1'}}})
recv(1, time.time() + 30)
send({'jsonrpc': '2.0', 'method': 'notifications/initialized', 'params': {}})

la = call('bhx_list_addresses', {})
addrs = la['data'].get('addresses', [])
other = next((a for a in addrs if not a.get('selected')), None)
print('target (non-selected) id:', other.get('id') if other else None)

sel = call('bhx_select_address', {'address_id': str(other.get('id'))})
print('SELECT RESPONSE:', json.dumps(sel, ensure_ascii=False)[:400])

ctx = call('bhx_get_delivery_context', {})
print('CONTEXT AFTER:', json.dumps({k: ctx['data'].get(k) for k in
      ('address_id', 'store_id', 'ward_id', 'verified', 'price_source')}, ensure_ascii=False))

# restore original selection
cur = next((a for a in addrs if a.get('selected')), None)
sel2 = call('bhx_select_address', {'address_id': str(cur.get('id'))})
print('RESTORE RESPONSE:', json.dumps(sel2, ensure_ascii=False)[:400])
ctx2 = call('bhx_get_delivery_context', {})
print('CONTEXT RESTORED:', json.dumps({k: ctx2['data'].get(k) for k in
      ('address_id', 'store_id', 'ward_id', 'verified')}, ensure_ascii=False))

proc.stdin.close()
try:
    proc.wait(timeout=20)
except subprocess.TimeoutExpired:
    proc.kill()
print('server_exit', proc.returncode)
