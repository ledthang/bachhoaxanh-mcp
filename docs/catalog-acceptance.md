# Authenticated catalog milestone — partial, not Phase 0/1 completion

## Live evidence

Observed 2026-10-30 **02:16:24–02:16:39 UTC** (2026-10-29 in America/Los_Angeles).
One headless Chromium, existing persistent authenticated profile, sequential queries.
Profile/cart/address identifiers compared in memory only; none published here. Each
query's province/ward/store matched authenticated cart and saved selected address.
No purchase clicks, account/address/cart mutations, checkout or payment performed.

Method: `scripts/catalog-acceptance.mjs` compares response products with visible
`.box_product` cards identified by exact observed product path. Raw API account
data never saved. Sanitized product-only observations go to ignored
`data/catalog-acceptance.json`. Search response sizes: chicken 3, pork 10, salmon
query 9, greens 1, milk 10. No three-product truncation remains. `cá hồi` actually
returned baby porridge among its first results; these are not described as fish.

All rows: API `isCanBuy=true`; availability **unknown**, quantity-specific stock
**unknown**, inventory/maximum **null**. MUA, promotional quotas and purchase caps
are not proof of stock. Every overall verdict is **partial**, even when price and
package comparisons pass. Names below are API names; UI often abbreviates names.
Prices in VND; brackets show reference price, not guaranteed payable price.

| UTC time | Product ID / API name | Package: API versus website | API price versus website | Website promotion | Individual verdict |
|---|---|---|---|---|---|
| 02:16:24 | 232936 — Ức gà có xương 500g | 500g / 500g: pass | 42,315 [45,500] / 39,130 [45,500]: mismatch | -14%; tối đa 10 sp/đơn; còn 99 suất | **Partial**: package passes; price/promotion unresolved; stock unknown |
| 02:16:24 | 222888 — Ức gà có xương | API unit Kg, no selected weight / website 400g, 89,000/kg | API 35,600; 44,500; 53,400 / website 35,600 | No explicit promotion label observed | **Partial**: one price matches; variant/weight mapping unknown |
| 02:16:28 | 333450 — Thịt heo xay C.P túi 100g | 100g / 100g: pass | 12,340.7407407407 [14,000] / 11,921 [14,000]: mismatch | -15%; tối đa 10 sp/đơn; còn 650 suất | **Partial**: decimal preserved, not silently rounded into UI price |
| 02:16:28 | 283165 — Thịt heo xay C.P khay 200g | Name says khay; raw unit says Túi 200gr; UI 200g | 23,800 [27,000] / 22,990 [27,000]: mismatch | -15%; tối đa 10 sp/đơn; còn 900 suất | **Partial**: mass matches, container labels conflict |
| 02:16:31 | 136231 — Cháo tươi cá hồi và cải bó xôi SG Food Baby gói 240g | 240g / Gói 240g: pass; UI shortened name | 26,500 / 26,500: pass | No explicit promotion label observed | **Partial**: price/package pass; stock unknown |
| 02:16:31 | 200033 — Cháo tươi Cây Thị cá hồi gói 240g | 240g / Gói 240g: pass; observed URL contains 260g, never used as weight | 26,500 / 26,500: pass | No explicit promotion label observed | **Partial**: price/package pass; stock unknown |
| 02:16:35 | 335195 — Cải ngọt túi 400g | 400g / 400g: pass | 5,000 [6,900] / 5,000 [6,900]: pass | -28% | **Partial**: price/package pass; promotion eligibility/stock unknown |
| 02:16:39 | 76888 — Sữa tươi tiệt trùng không đường Vinamilk 100% Sữa tươi hộp 1 lít | 1 lít / Hộp 1 lít: pass; UI shortened name | 41,000 / 41,000: pass | MUA HỘP THỨ 2 GIÁ 34.000Đ/HỘP | **Partial**: base price passes; multi-buy not modeled |
| 02:16:39 | 292407 — Sữa tươi tiệt trùng không đường Vinamilk 100% Sữa tươi bịch 220ml | 220ml / Bịch 220ml: pass | 9,400 / 9,400: pass | GIẢM 5.000Đ KHI MUA 10 BỊCH | **Partial**: base price passes; conditional discount unknown |
| 02:16:39 | 79312 — Sữa tươi tiệt trùng có đường Vinamilk 100% Sữa tươi hộp 1 lít | 1 lít / Hộp 1 lít: pass | 41,000 / 41,000: pass | MUA HỘP THỨ 2 GIÁ 34.000Đ/HỘP | **Partial**: base price passes; multi-buy unknown |
| 02:16:39 | 235865 — Lốc 4 hộp sữa tươi tiệt trùng rất ít đường Vinamilk Green Farm 180ml | 4 × 180ml / 4 hộp 180ml: pass | 42,000 / 42,000: pass | GIẢM 5.000Đ KHI MUA 5 LỐC | **Partial**: base price/package pass; conditional discount unknown |
| 02:16:39 | 235869 — Thùng 48 hộp sữa tươi tiệt trùng rất ít đường Vinamilk Green Farm 110ml | 48 × 110ml / 48 hộp 110ml: pass | 305,000 / 305,000: pass | No explicit promotion label observed | **Partial**: price/package pass; stock unknown |

## Generic detail proof

Separate live reads, approximately 02:13 UTC, resolved **76888 and 235865** from
authenticated `sữa tươi` results, then navigated the returned paths. Both detail
response IDs and visible H1 names matched; detail request province/ward/store
matched authenticated delivery context. Own box variant `type=1`, `scenario=0`;
prices 41,000 and 42,000 respectively matched displayed product-region amounts.
Other package prices also occur in that region (76888: 418,000; 235865: 465,000).
Therefore presence of a currency token does not establish selected payable price
or a variant mapping. Detail exposes only own matching box, not all related boxes.

## Supported contract and blockers

- `bhx_get_product`: `{ "query": "sữa tươi", "product_id": 76888 }`.
- `bhx_check_availability`: `{ "query": "sữa tươi", "items": [{ "product_id": 76888, "quantity": 2 }] }`.
- Lookup requires exactly one matching ID in current authenticated search response.
  No caller-supplied paths, arbitrary URLs, invented routes or cached cross-context IDs.
- Detail GET accepts only observed endpoint, matching ID/path and delivery context;
  duplicate/foreign/unknown parameters fail closed. Missing result requires a better query.
- Pack labels and raw unit preserved. Explicit nominal mass/volume and multipack
  count normalized from name, never URL or inferred inventory. Missing selected
  weight stays unknown; normalized label mass is not measured delivered weight.
- Prices retain finite decimals. Search and detail use `price_vnd`,
  `list_price_vnd`, `can_buy`; stock and maximum never derived from `quantity=200`.
  All `isCanBuy=false` means unavailable; true/missing does not prove available.
- Promotion eligibility unknown; API price reduction does not describe multi-buy
  conditions. Raw website promotion labels above preserve observed evidence.
- Initial-response search only. Site request contains pageIndex/pageSize, but no
  next-page interaction/response contract verified; pagination not implemented.
- Keep `/gio-hang` bootstrap because it works, **not** because only that route
  emits cart POST. Search navigation can emit original site cart POST too.
- One repeat encountered transient read/comparison failures for pork and milk;
  next full sequential run produced all 12 rows. No failed read treated as success.
- Remaining gates: payable price/promotion reconciliation, selected variable-weight
  mapping, positive quantity-specific stock proof, broader detail variants, reliable
  pagination, and remaining Phase 0/1 requirements. Neither phase is complete.

## Reproduce

```sh
BHX_CHROMIUM_PATH=/home/openclaw/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome node scripts/catalog-acceptance.mjs
npm test
node scripts/product.test.mjs
node scripts/catalog-poc.test.mjs
node scripts/cart-poc.test.mjs
node scripts/cart-refresh.test.mjs
node scripts/cart-trial.test.mjs
node scripts/cart-cycle.test.mjs
git diff --check
```

All listed offline checks passed after updating empty-result expectation to a valid
empty array and adding ten-result regression. No commit/push. Cart mutation module
unchanged. Run live collector only with exclusive profile/browser ownership.
