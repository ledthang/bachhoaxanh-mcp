import json, subprocess, time
root='/home/openclaw/.hermes/workspace/bachhoaxanh-mcp'
p=subprocess.Popen(['node','src/server.mjs'],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1)
def send(o): p.stdin.write(json.dumps(o)+"\n"); p.stdin.flush()
def read_until(id_, timeout=20):
    t0=time.time()
    while time.time()-t0<timeout:
        l=p.stdout.readline()
        if not l: return None
        try: d=json.loads(l)
        except Exception: continue
        if d.get("id")==id_: return d
    return None
send({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"audit","version":"1"}}})
init=read_until(1)
print("INIT protocol", init.get("result",{}).get("protocolVersion"), "server", init.get("result",{}).get("serverInfo"))
send({"jsonrpc":"2.0","method":"notifications/initialized"})
tools=read_until(2) if (send({"jsonrpc":"2.0","id":2,"method":"tools/list"}) or True) else None
ts=(tools or {}).get("result",{}).get("tools",[])
print("COUNT", len(ts))
for t in ts: print("-", t["name"])
p.stdin.close()
try: p.wait(timeout=8)
except Exception: p.kill()
