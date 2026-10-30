#!/usr/bin/env python3
# Live proof: the login/session-expiry gate is now ACTIONABLE, not blind.
#  - REAL persistent profile (logged in)  -> bhx_auth_status authenticated:true
#  - COLD profile (no session)            -> REQUIRES_LOGIN (actionable), NOT BHX_READ_UNVERIFIED
# stdio session, real BHX. Cold run opens its own profile dir so it cannot
# touch the logged-in session. Prints both outcomes.
import json, os, subprocess, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, "src", "server.mjs")
CHROMIUM = "/home/openclaw/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"

def session(profile_dir, calls):
    env = dict(os.environ)
    env["BHX_CHROMIUM_PATH"] = CHROMIUM
    env["BHX_PROFILE_DIR"] = profile_dir
    p = subprocess.Popen(["node", SERVER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, cwd=ROOT, env=env, bufsize=1, text=True)
    def send(obj):
        p.stdin.write(json.dumps(obj) + "\n"); p.stdin.flush()
        return json.loads(p.stdout.readline())
    out = {}
    send({"jsonrpc": "2.0", "id": 0, "method": "initialize",
          "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                    "clientInfo": {"name": "login-gate", "version": "1"}}})
    for label, payload in calls.items():
        out[label] = send(payload)
    p.stdin.close(); p.wait(timeout=10)
    return out

def summarize(label, resp):
    txt = resp.get("result", {}).get("content", [{}])[0].get("text", "")
    try:
        data = json.loads(txt)
    except Exception:
        data = {"_raw": txt[:200]}
    keys = {k: data[k] for k in ("authenticated", "requires_login", "session_status") if k in data}
    actionable = txt.startswith("REQUIRES_LOGIN:")
    blind = "BHX_READ_UNVERIFIED" in txt
    print(f"[{label}] authenticated={data.get('authenticated')} "
          f"requires_login={data.get('requires_login')} "
          f"actionable_REQUIRES_LOGIN={actionable} blind_UNVERIFIED={blind}")
    return {"authenticated": data.get("authenticated"),
            "requires_login": data.get("requires_login"),
            "actionable": actionable, "blind": blind}

print("=== REAL (logged-in persistent profile) ===")
real = summarize("auth_status", session(
    os.path.expanduser("~/.local/share/bhx-mcp/profile"),
    {"auth": {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
              "params": {"name": "bhx_auth_status", "arguments": {}}}})["auth"])

print("=== COLD (fresh profile, no session) ===")
cold_dir = tempfile.mkdtemp(prefix="bhx-cold-gate-")
cold_resp = session(cold_dir, {
    "auth": {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
             "params": {"name": "bhx_auth_status", "arguments": {}}},
    "cart": {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
             "params": {"name": "bhx_get_cart", "arguments": {}}},
})
cold_auth = summarize("auth_status", cold_resp["auth"])
cold_cart = summarize("cart", cold_resp["cart"])

print("=== VERDICT ===")
ok = (real["authenticated"] is True
      and cold_auth["actionable"] and not cold_auth["blind"]
      and cold_cart["actionable"] and not cold_cart["blind"])
print("PASS: login gate actionable (real=authenticated, cold=REQUIRES_LOGIN not blind)"
      if ok else "CHECK: see lines above")
