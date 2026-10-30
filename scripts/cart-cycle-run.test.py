"""Offline acceptance-driver checks. Never starts MCP or a browser."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile

spec = importlib.util.spec_from_file_location("cart_driver", Path(__file__).with_name("cart-cycle-run.py"))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)
context = {"verified": True, "store_id": 5, "province_id": 3, "ward_id": 4}
baseline_item = {"product_id": 10, "line_id": "baseline", "name": "Test", "quantity": 1, "unit_price": 4000, "total": 4000, "inactive": False}


class FakeClient:
    corrupt = False
    instances = []

    def __init__(self, directory):
        self.items = [copy.deepcopy(baseline_item)]
        self.owned = {}
        self.calls = []
        self.instances.append(self)

    def call(self, method, params):
        assert method == "initialize"
        return {}

    def close(self):
        pass

    def tool(self, name, arguments=None):
        self.calls.append(name)
        prices = [{"price_vnd": 4000, "list_price_vnd": 4000, "can_buy": True}]
        if name == "bhx_get_cart":
            return copy.deepcopy({"items": self.items, "total": sum(item["total"] for item in self.items), "context": context})
        if name == "bhx_search_products":
            return {"context": context, "products": [{"product_id": product, "prices": prices} for product in (10, 20, 30)]}
        if name == "bhx_get_product":
            return {"context": context, "variant": 1, "scenario": 0, "prices": prices}
        assert arguments["user_authorized"] is True
        if name == "bhx_add_to_cart":
            product = arguments["product_id"]
            assert product != 10
            self.items.append({**baseline_item, "product_id": product, "line_id": "raw-" + str(product)})
            self.owned[product] = {"product_id": product, "line_id": "handle-" + str(product), "quantity": 1, "unit_price_vnd": 4000, "total_vnd": 4000}
        else:
            product = next(product for product, item in self.owned.items() if item["line_id"] == arguments["line_id"])
            if name == "bhx_remove_cart_item":
                self.items = [item for item in self.items if item["product_id"] != product]
                del self.owned[product]
            elif name == "bhx_update_cart_item":
                quantity = arguments["quantity"]
                item = next(item for item in self.items if item["product_id"] == product)
                item.update(quantity=quantity, total=quantity * 4000)
                self.owned[product].update(quantity=quantity, total_vnd=quantity * 4000)
                if self.corrupt:
                    next(item for item in self.items if item["product_id"] == 20)["name"] = "Unexpected change"
            else:
                raise AssertionError("unexpected tool")
        return copy.deepcopy({"verified": True, "operation": name, "items": list(self.owned.values())})


driver.Client = FakeClient
for corrupt in (False, True):
    with tempfile.TemporaryDirectory() as directory:
        driver.ROOT = Path(directory)
        sys.argv = ["cart-cycle-run.py", "--authorize-live-cart-trial"]
        FakeClient.corrupt = corrupt
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            assert driver.main() == (1 if corrupt else 0)
        instance = FakeClient.instances[-1]
        assert "baseline" not in output.getvalue() or "baseline restored" in output.getvalue()
        assert "raw-" not in output.getvalue() and "handle-" not in output.getvalue()
        if corrupt:
            assert "bhx_remove_cart_item" not in instance.calls
            diagnostic = json.loads(next(driver.ROOT.glob("data/*/cleanup-required.json")).read_text())
            assert diagnostic["cleanup_required"] is True
            assert diagnostic["phase"] == "updateB"
        else:
            assert instance.items == [baseline_item]
            assert instance.calls.count("bhx_remove_cart_item") == 2
print("PASS: driver full sequential lifecycle, baseline exclusion, A-preservation failure stops without cleanup; no MCP/network.")
