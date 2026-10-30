#!/usr/bin/env python3
"""Opt-in two-product preservation trial. No checkout, retries or blind cleanup."""
import argparse
import json
import os
from pathlib import Path
import selectors
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def cart_state(value):
    items = value.get("items")
    if not isinstance(items, list) or len({item["line_id"] for item in items}) != len(items):
        raise RuntimeError("ambiguous cart")
    return sorted(items, key=lambda item: item["line_id"]), value["total"]


def verify_cart(value, baseline, trial):
    items, total = cart_state(value)
    baseline_items, baseline_total = cart_state(baseline)
    expected = baseline_items + list(trial.values())
    if items != sorted(expected, key=lambda item: item["line_id"]):
        raise RuntimeError("target or unrelated line changed")
    if total != baseline_total + sum(item["total"] for item in trial.values()):
        raise RuntimeError("cart total changed unexpectedly")
    context_keys = ("store_id", "province_id", "ward_id")
    if not value.get("context", {}).get("verified") or any(value["context"].get(key) != baseline["context"].get(key) for key in context_keys):
        raise RuntimeError("delivery context changed")


class Client:
    def __init__(self, directory):
        self.evidence = open(directory / "rpc.jsonl", "x", encoding="utf-8")
        self.stderr = open(directory / "stderr.log", "x", encoding="utf-8")
        self.process = subprocess.Popen(["node", "src/server.mjs"], cwd=ROOT, env=dict(os.environ), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.buffer = b""
        self.sequence = 0

    def record(self, direction, message):
        self.evidence.write(json.dumps({"direction": direction, "message": message}, ensure_ascii=False) + "\n")
        self.evidence.flush()
        os.fsync(self.evidence.fileno())

    def call(self, method, params=None, timeout=180):
        self.sequence += 1
        message = {"jsonrpc": "2.0", "id": self.sequence, "method": method}
        if params is not None:
            message["params"] = params
        self.record("request", message)
        self.process.stdin.write((json.dumps(message) + "\n").encode())
        self.process.stdin.flush()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if b"\n" not in self.buffer:
                if not self.selector.select(max(0, deadline - time.monotonic())):
                    break
                chunk = os.read(self.process.stdout.fileno(), 65536)
                if not chunk:
                    raise RuntimeError("MCP stdout closed")
                self.buffer += chunk
                if len(self.buffer) > 8 * 1024 * 1024:
                    raise RuntimeError("MCP response too large")
                continue
            raw, self.buffer = self.buffer.split(b"\n", 1)
            response = json.loads(raw)
            self.record("response", response)
            if response.get("id") != self.sequence or "error" in response:
                raise RuntimeError("MCP protocol failure")
            result = response["result"]
            if result.get("isError"):
                raise RuntimeError("MCP operation unverified")
            return result
        raise RuntimeError("MCP response timeout")

    def tool(self, name, arguments=None):
        result = self.call("tools/call", {"name": name, "arguments": arguments or {}})
        content = result["content"]
        if len(content) != 1 or content[0]["type"] != "text":
            raise RuntimeError("ambiguous MCP content")
        return json.loads(content[0]["text"])

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        self.selector.close()
        self.evidence.close()
        self.stderr.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--authorize-live-cart-trial", action="store_true", required=True)
    parser.add_argument("--query", action="append", help="Fresh authenticated search; repeat for more candidates")
    parser.add_argument("--max-unit-price-vnd", type=int, default=10000)
    args = parser.parse_args()
    if not 1 <= args.max_unit_price_vnd <= 9007199254740991:
        parser.error("price ceiling must be a positive safe integer")
    os.umask(0o077)
    directory = ROOT / "data" / ("cart-preservation-" + time.strftime("%Y%m%d-%H%M%S") + "-" + str(os.getpid()))
    directory.mkdir(parents=True, mode=0o700)
    client = Client(directory)
    owned = {}
    trial = {}
    mutation_attempted = False
    phase = "initialize"
    try:
        client.call("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "cart-preservation-driver", "version": "3"}})
        phase = "baseline"
        baseline = client.tool("bhx_get_cart")
        cart_state(baseline)
        if not baseline.get("context", {}).get("verified"):
            raise RuntimeError("unverified baseline")
        baseline_ids = {item["product_id"] for item in baseline["items"]}
        candidates = {}
        phase = "fresh-search"
        for query in args.query or ["cải ngọt"]:
            result = client.tool("bhx_search_products", {"query": query})
            if result["context"] != baseline["context"]:
                raise RuntimeError("search context differs from baseline")
            for product in result["products"]:
                prices = product.get("prices", [])
                if product["product_id"] not in baseline_ids and prices and all(price.get("can_buy") is True and 0 < price["price_vnd"] <= price["list_price_vnd"] <= args.max_unit_price_vnd for price in prices):
                    candidates[product["product_id"]] = (max(price["list_price_vnd"] for price in prices), query, product)
        selected = sorted(candidates.values(), key=lambda candidate: candidate[0])[:2]
        if len(selected) != 2:
            raise RuntimeError("two distinct cheap purchasable products not observed")
        for _, query, product in selected:
            detail = client.tool("bhx_get_product", {"query": query, "product_id": product["product_id"]})
            if detail.get("variant") is None or detail.get("scenario") is None or detail.get("context") != baseline["context"] or not detail.get("prices") or not all(price.get("can_buy") is True and 0 < price["price_vnd"] <= price["list_price_vnd"] <= args.max_unit_price_vnd for price in detail["prices"]):
                raise RuntimeError("product detail not purchase-enabled within ceiling")
        verify_cart(client.tool("bhx_get_cart"), baseline, trial)

        def change(label, name, arguments, product_id=None, quantity=None):
            nonlocal mutation_attempted, phase
            phase = label
            mutation_attempted = True
            result = client.tool(name, {**arguments, "user_authorized": True})
            if result.get("verified") is not True or result.get("operation") != name:
                raise RuntimeError("mutation not verified")
            if name == "bhx_remove_cart_item":
                del owned[label[-1]]
            else:
                matches = [item for item in result["items"] if item["product_id"] == product_id]
                if len(matches) != 1 or matches[0]["quantity"] != quantity:
                    raise RuntimeError("ambiguous ownership")
                previous = owned.get(label[-1])
                if previous and previous["line_id"] != matches[0]["line_id"]:
                    raise RuntimeError("ownership handle changed")
                owned[label[-1]] = matches[0]
            if {item["line_id"] for item in result["items"]} != {item["line_id"] for item in owned.values()}:
                raise RuntimeError("unexpected runtime-owned lines")
            value = client.tool("bhx_get_cart")
            trial.clear()
            for key, entry in owned.items():
                matches = [item for item in value["items"] if item["product_id"] == entry["product_id"] and item["product_id"] not in baseline_ids]
                if len(matches) != 1 or matches[0]["quantity"] != entry["quantity"] or matches[0]["unit_price"] != entry["unit_price_vnd"] or matches[0]["total"] != entry["total_vnd"] or matches[0]["inactive"]:
                    raise RuntimeError("exact trial line not observed")
                if key in previous_trial and {**matches[0], "quantity": previous_trial[key]["quantity"], "total": previous_trial[key]["total"]} != previous_trial[key]:
                    raise RuntimeError("trial line identity or price changed")
                trial[key] = matches[0]
            if label in ("addB", "updateB", "removeB") and trial["A"] != previous_trial["A"]:
                raise RuntimeError("A changed during B operation")
            verify_cart(value, baseline, trial)
            previous_trial.clear()
            previous_trial.update(trial)
            print(label + ": verified", flush=True)

        previous_trial = {}
        for key, (_, _, product) in zip(("A", "B"), selected):
            change("add" + key, "bhx_add_to_cart", {"product_id": product["product_id"], "quantity": 1, "max_unit_price_vnd": args.max_unit_price_vnd}, product["product_id"], 1)
        change("updateB", "bhx_update_cart_item", {"line_id": owned["B"]["line_id"], "quantity": 2}, owned["B"]["product_id"], 2)
        for key in ("B", "A"):
            change("remove" + key, "bhx_remove_cart_item", {"line_id": owned[key]["line_id"]})
        phase = "baseline-restored"
        verify_cart(client.tool("bhx_get_cart"), baseline, {})
        print("PASS: baseline restored; no checkout/payment", flush=True)
        return 0
    except Exception:
        diagnostic = {"phase": phase, "cleanup_required": mutation_attempted, "known_trial_owned_lines": owned, "action": "STOP. Inspect private evidence and real cart. No retry or automatic cleanup."}
        (directory / "cleanup-required.json").write_text(json.dumps(diagnostic, ensure_ascii=False, indent=2), encoding="utf-8")
        print("STOP: phase=" + phase + "; cleanup_required=" + str(mutation_attempted).lower() + "; inspect private data/cart-preservation-* evidence; no retries", flush=True)
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
