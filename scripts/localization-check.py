# Per-store price localization: same queries observed in store A (14524) then store B (14509).
# One stdio MCP session. Cart empty => address change permitted. Restores home at end.
# Extracts price from the real projected shape: products[].prices[].price_vnd.
import json, subprocess, time

ROOT = '/home/openclaw/.hermes/workspace/bachhoaxanh-mcp'
p = subprocess.Popen(['node', 'src/server.mjs'], cwd=ROOT, stdin=subprocess.PIPE,
                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)


def send(o):
    p.stdin.write(json.dumps(o) + '\n')
    p.stdin.flush()


def ru(i, t=200):
    t0 = time.time()
    while time.time() - t0 < t:
        line = p.stdout.readline()
        if not line:
            return None
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get('id') == i:
            return d
    return None


n = [0]


def call(name, args):
    n[0] += 1
    send({'jsonrpc': '2.0', 'id': n[0], 'method': 'tools/call', 'params': {'name': name, 'arguments': args}})
    r = ru(n[0]) or {}
    txt = ''.join(c.get('text', '') for c in r.get('result', {}).get('content', []) if c.get('type') == 'text')
    try:
        return json.loads(txt)
    except Exception:
        return {'_raw': txt[:160]}


def price_of(prod):
    ps = prod.get('prices') or []
    if not ps:
        return None
    vals = [x.get('price_vnd') for x in ps if isinstance(x.get('price_vnd'), (int, float))]
    return min(vals) if vals else None


send({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
      'params': {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'loc', 'version': '1'}}})
ru(1)
send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})

QUERIES = ['gạo ST25', 'nước mắm 500ml', 'trứng gà', 'sữa tươi không đường', 'mì gói', 'dầu ăn']


def harvest(tag):
    out = {}
    for q in QUERIES:
        r = call('bhx_search_products', {'query': q})
        prods = r.get('products', [])
        for pr in prods:
            pid = pr.get('product_id')
            if pid and pid not in out:
                out[pid] = {'name': (pr.get('name') or '')[:55], 'price': price_of(pr), 'q': q}
        print(f'{tag} {q!r}: {len(prods)} results')
    return out


print('== context A ==')
ctxA = call('bhx_get_delivery_context', {})
print('store', ctxA.get('store_id'), 'ward', ctxA.get('ward_id'), 'verified', ctxA.get('verified'))
A = harvest('A')
print('distinct A:', len(A))

print('== switch to store for 110346409 ==')
sw = call('bhx_select_address', {'address_id': '110346409'})
print('select:', {k: sw.get(k) for k in ('selected', 'changed', 'restart_verified')})
ctxB = call('bhx_get_delivery_context', {})
print('store', ctxB.get('store_id'), 'ward', ctxB.get('ward_id'), 'verified', ctxB.get('verified'))
B = harvest('B')
print('distinct B:', len(B))

common = sorted(set(A) & set(B))
print('\n== compare %d products in both stores ==' % len(common))
same = diff = 0
rows = []
for pid in common:
    a, b = A[pid], B[pid]
    if a['price'] == b['price']:
        same += 1
        tag = 'same'
    else:
        diff += 1
        tag = 'DIFF'
    rows.append({'id': pid, 'name': a['name'], 'A': a['price'], 'B': b['price'], 'tag': tag})
    if tag == 'DIFF':
        print(f'DIFF {pid} {a["name"]!r}: A={a["price"]} B={b["price"]}')
print('same=%d different=%d onlyA=%d onlyB=%d' % (same, diff, len(set(A) - set(B)), len(set(B) - set(A))))

print('== restore home ==')
back = call('bhx_select_address', {'address_id': '90713515'})
print('restore:', {k: back.get(k) for k in ('selected', 'changed', 'restart_verified')})
ctxC = call('bhx_get_delivery_context', {})
print('final store', ctxC.get('store_id'), 'ward', ctxC.get('ward_id'), 'verified', ctxC.get('verified'))
cart = call('bhx_get_cart', {})
print('final cart items', len(cart.get('items', [])), 'total', cart.get('total'))

with open(ROOT + '/data/localization-20261030.json', 'w') as f:
    json.dump({'storeA': ctxA.get('store_id'), 'storeB': ctxB.get('store_id'),
               'common': rows, 'same': same, 'different': diff,
               'onlyA_count': len(set(A) - set(B)), 'onlyB_count': len(set(B) - set(A))},
              f, ensure_ascii=False, indent=1)
p.stdin.close()
try:
    p.wait(timeout=10)
except Exception:
    p.kill()
print('done')
