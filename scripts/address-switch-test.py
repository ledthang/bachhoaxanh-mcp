#!/usr/bin/env python3
"""Address-switch acceptance test over one stdio MCP session (cart empty => allowed).
Uses real field name `id`. Flow: list -> context -> select addr2 -> context CHANGED ->
select addr1 -> context RESTORED. Never checkout."""
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


n = [100]
def call(name, args):
    n[0] += 1
    send({'jsonrpc': '2.0', 'id': n[0], 'method': 'tools/call',
          'params': {'name': name, 'arguments': args}})
    r = recv(n[0], time.time() + 170)
    if not r:
        return {'_err': 'NO_RESPONSE'}
    txt = ''.join(c.get('text', '') for c in r.get('result', {}).get('content', []) if c.get('type') == 'text')
    try:
        return json.loads(txt)
    except json.JSONDecodeError:
        return {'_text': txt[:200]}


send({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
      'params': {'protocolVersion': '2024-11-05', 'capabilities': {},
                 'clientInfo': {'name': 'switch', 'version': '1'}}})
recv(1, time.time() + 30)
send({'jsonrpc': '2.0', 'method': 'notifications/initialized', 'params': {}})

la = call('bhx_list_addresses', {})
addrs = la.get('addresses', [])
print('addresses:', len(addrs))
for a in addrs:
    print('  id=%s selected=%s label=%s' % (a.get('id'), a.get('selected'),
          (a.get('label') or a.get('address') or '')[:48]))

if len(addrs) != 2:
    print('RESULT: BLOCKED - need exactly 2 addresses, got', len(addrs))
else:
    cur = next((a for a in addrs if a.get('selected')), None)
    other = next((a for a in addrs if not a.get('selected')), None)
    ctx0 = call('bhx_get_delivery_context', {})
    print('current: id=%s store=%s ward=%s verified=%s' % (
        ctx0.get('address_id'), ctx0.get('store_id'), ctx0.get('ward_id'), ctx0.get('verified')))

    sel = call('bhx_select_address', {'address_id': str(other.get('id'))})
    ctx1 = call('bhx_get_delivery_context', {})
    changed = (str(ctx1.get('address_id')) == str(other.get('id'))
               and (ctx1.get('store_id') != ctx0.get('store_id') or ctx1.get('ward_id') != ctx0.get('ward_id')))
    print('after switch: id=%s store=%s ward=%s verified=%s changed=%s' % (
        ctx1.get('address_id'), ctx1.get('store_id'), ctx1.get('ward_id'),
        ctx1.get('verified'), changed))

    back = call('bhx_select_address', {'address_id': str(cur.get('id'))})
    ctx2 = call('bhx_get_delivery_context', {})
    restored = (str(ctx2.get('address_id')) == str(cur.get('id'))
                and ctx2.get('store_id') == ctx0.get('store_id')
                and ctx2.get('ward_id') == ctx0.get('ward_id')
                and ctx2.get('verified') is True)
    print('after back: id=%s store=%s ward=%s verified=%s restored=%s' % (
        ctx2.get('address_id'), ctx2.get('store_id'), ctx2.get('ward_id'),
        ctx2.get('verified'), restored))

    if changed and restored:
        print('RESULT: PASS address-switch changed and restored')
    else:
        print('RESULT: INCONCLUSIVE (changed=%s restored=%s) - do not mark gate done' % (changed, restored))

proc.stdin.close()
try:
    proc.wait(timeout=20)
except subprocess.TimeoutExpired:
    proc.kill()
print('server_exit', proc.returncode)
