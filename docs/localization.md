# Per-store price localization — 2026-10-30

Question: does BHX price the same product differently by delivery store (ward)? Observed
via one stdio MCP session; address switched between the two saved addresses and the same
queries re-issued; home restored at the end. Cart empty throughout (no mutation).

## Method
- Store A = 14524 (ward 101462, HOME 90713515), Store B = 14509 (ward 101469, 110346409).
- 6 queries (gạo ST25, nước mắm 500ml, trứng gà, sữa tươi không đường, mì gói, dầu ăn)
  harvested in A, then B; compared over products present in both (`scripts/localization-check.py`).
- Price = min `prices[].price_vnd` of the projected product.

## Result
- Common products compared: **38**. Identical: **37**. Differing: **1**.
- Differing item: **Mì Đệ Nhất thịt bằm gói 83g** (id 77654) — **8500đ in store 14524,
  8700đ in store 14509** (+200đ / +2.4%).

## Drift ruled out (re-probed, reproducible)
Re-checked the divergent SKU three times, A→B→A (each `bhx_get_product`, fresh context read):

| probe | store | price |
| --- | --- | --- |
| A2 | 14524 | 8500 |
| B2 | 14509 | 8700 |
| A3 | 14524 | 8500 |

Same value returns on returning to store A ⇒ **genuine per-store localization**, not a
promotion expiring mid-run. Cart 0 items / 0đ at every read.

## Scope / honesty
- 1 differing SKU out of 38 common in this sample; that proves localization *exists*, not
  its breadth. Majority of sampled staples are nationally priced.
- Prices are `price_status: catalog-observed-not-guaranteed-payable` — still not checkout
  guarantees (that gate stays open).
