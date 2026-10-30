#!/usr/bin/env python3
"""Sequential MCP driver: authenticated BHX evidence over stdio.

Spawns the MCP server once, speaks line-delimited JSON-RPC, appends every
result to a workspace JSON file. Never prints raw cookie/token values.
"""
import json, os, subprocess, sys, time

ROOT = os.path.expanduser("~/.hermes/workspace/bachhoaxanh-mcp")
OUT = os.path.join(ROOT, "data", "evidence-run.json")
NODE = "/usr/bin/node"
SERVER = os.path.join(ROOT, "src", "server.mjs")
CHROMIUM = os.path.expanduser("~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome")

SENSITIVE_KEYS = {"token", "accessToken", "refreshToken", "cookie", "sessionToken",
                  "phone", "phoneNumber", "address", "addressLine", "fullName", "name_receiver"}


def scrub(obj):
    if isinstance(obj, dict):
        return {k: ("[scrubbed]" if k in SENSITIVE_KEYS else scrub(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [scrub(v) for v in obj]
    return obj


def main():
    env = dict(os.environ)
    env["BHX_CHROMIUM_PATH"] = CHROMIUM
    env["BHX_HEADED"] = "0"  # MCP reads headless; VNC login browser is separate and now closed
    proc = subprocess.Popen([NODE, SERVER], cwd=ROOT, env=env,
                           stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, text=True, bufsize=1)
    lock = {"seq": 0}

    def send(method, params=None, timeout=120):
        lock["seq"] += 1
        rid = lock["seq"]
        msg = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            msg["params"] = params
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()
        start = time.time()
        while time.time() - start < timeout:
            line = proc.stdout.readline()
            if not line:
                return {"_error": "stdout closed"}
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if d.get("id") == rid:
                return d
        return {"_error": "timeout"}

    results = []

    def call(label, method, params=None, timeout=120):
        t0 = time.time()
        r = send(method, params, timeout)
        rec = {"label": label, "method": method,
               "elapsed_s": round(time.time() - t0, 1), "response": scrub(r)}
        results.append(rec)
        print(json.dumps({"label": label, "elapsed_s": rec["elapsed_s"],
                          "ok": "result" in r,
                          "keys": sorted((r.get("result") or {}).keys())[:8]}, ensure_ascii=False), flush=True)
        return r

    init = call("initialize", "initialize",
               {"protocolVersion": "2024-11-05", "capabilities": {},
                "clientInfo": {"name": "evidence-driver", "version": "1"}}, 60)
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
    proc.stdin.flush()
    if "result" not in init:
        print("INIT_FAILED", json.dumps(scrub(init))[:300], flush=True)
    else:
        print("INIT_OK server:", init["result"].get("serverInfo"), flush=True)

    call("auth_status", "tools/call", {"name": "bhx_auth_status", "arguments": {}}, 150)
    call("list_addresses", "tools/call", {"name": "bhx_list_addresses", "arguments": {}}, 150)
    call("delivery_context", "tools/call", {"name": "bhx_get_delivery_context", "arguments": {}}, 150)
    call("get_cart", "tools/call", {"name": "bhx_get_cart", "arguments": {}}, 150)

    for q in ["ức gà", "thịt heo xay", "cải ngọt", "trứng gà", "cá hồi", "gạo"]:
        call("search:" + q, "tools/call", {"name": "bhx_search_products", "arguments": {"query": q}}, 150)

    # detail + availability evidence for one product taken from the first search
    pid = None
    for rec in results:
        if rec["label"] == "search:cải ngọt":
            try:
                payload = json.loads(rec["response"]["result"]["content"][0]["text"])
                items = payload.get("products") or []
                if items:
                    pid = items[0]["product_id"]
            except Exception as exc:
                print("PID_EXTRACT_FAIL", repr(exc)[:120], flush=True)
    print("detail_probe product_id:", pid, flush=True)

    if pid:
        call("detail:%s" % pid, "tools/call",
             {"name": "bhx_get_product", "arguments": {"query": "cải ngọt", "product_id": pid}}, 180)
        call("availability:%s" % pid, "tools/call",
             {"name": "bhx_check_availability",
              "arguments": {"query": "cải ngọt", "items": [{"product_id": pid, "quantity": 1}]}}, 180)
        # Cart cycle on 335195 (only product the tools allow). Cart verified empty beforehand.
        call("cart_add:1", "tools/call",
             {"name": "bhx_add_to_cart",
              "arguments": {"user_authorized": True, "product_id": 335195, "quantity": 1,
                           "max_unit_price_vnd": 6900}}, 180)
        call("cart_after_add", "tools/call", {"name": "bhx_get_cart", "arguments": {}}, 150)
        line_id = None
        for rec in results:
            if rec["label"] == "cart_after_add":
                try:
                    c = json.loads(rec["response"]["result"]["content"][0]["text"])
                    items = c.get("items") or []
                    if len(items) == 1:
                        line_id = items[0]["line_id"]
                except Exception as exc:
                    print("LINE_EXTRACT_FAIL", repr(exc)[:120], flush=True)
        if line_id:
            call("cart_update:2", "tools/call",
                 {"name": "bhx_update_cart_item",
                  "arguments": {"user_authorized": True, "line_id": line_id, "quantity": 2}}, 180)
            call("cart_after_update", "tools/call", {"name": "bhx_get_cart", "arguments": {}}, 150)
            call("cart_remove", "tools/call",
                 {"name": "bhx_remove_cart_item",
                  "arguments": {"user_authorized": True, "line_id": line_id}}, 180)
            call("cart_after_remove", "tools/call", {"name": "bhx_get_cart", "arguments": {}}, 150)
        call("cart_summary", "tools/call", {"name": "bhx_cart_summary", "arguments": {}}, 150)

    with open(OUT, "w") as fh:
        json.dump(results, fh, ensure_ascii=False, indent=1)
    print("WROTE", OUT, flush=True)

    proc.stdin.close()
    try:
        proc.wait(timeout=20)
    except subprocess.TimeoutExpired:
        proc.kill()
    err = proc.stderr.read()
    if err:
        print("STDERR_TAIL:", err[-400:], flush=True)
    print("ALL_DONE", flush=True)


if __name__ == "__main__":
    main()
