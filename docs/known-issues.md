# Known issues

## KI-1 — Address-switch verification blocked (account has one saved address)

**Status:** closed 2026-10-30 (a second saved address appeared; cross-address verified).

The account previously had exactly one saved address (`selected=true`, `address_id=90713515`,
store `14524` / province `1020` / ward `101462`), so the acceptance criterion
"change address ⇒ delivery context changes" could not be exercised.

A second address (`110346409`, 205 Trần Phú, ward `101469`, createdDate 2026-10-30 16:10:41)
is now present. Real switch cycle verified: select 110346409 → store `14524→14509`, ward
`101462→101469` (`changed=true`, `verified=true`) → select 90713515 → context restored,
cart empty throughout. See `docs/address-acceptance.md` and `scripts/address-switch-test.py`.

**Residual:** per-store price localization not compared in this run (context change is
proven; repricing is not claimed).

## KI-2 — Web cart and mobile cart do not sync

**Status:** accepted, temporarily ignored (owner decision 2026-10-30; suspected
intentional BHX platform behaviour, two separate backends).

Observed while verifying cart persistence: an item added through the web session is
not necessarily visible in the mobile app cart, and vice versa.

**Impact:** "visible on BHX website **or** app" (spec section 1.7) is satisfied via the
web surface only. This integration talks to the web surface and does not read or write
the mobile surface, so it cannot bridge the two.

**Upgrade path:** confirm with BHX whether the two carts are independent product lines;
if a single source of truth exists, point the integration at it.

## KI-3 — `hermes verify` detector cannot model a stdio MCP server

**Status:** closed 2026-10-30 (manifest pinned: `start: null`, `port: null`).

The detector initially emitted `start: "npm run start"` with `port: null`, then fell back
to polling `http://127.0.0.1:8000/`, which returns connection refused. This server is an
MCP **stdio** server: it opens no HTTP port, so the poll is meaningless.

Pinned in `.hermes/environment.json`: `start: null`, `port: null`, `readinessPath: null`,
with evidence naming `scripts/mcp-read-check.py` as the stdio readiness proof.
`hermes verify --json` now reports `ok: true`.

## KI-4 — Promotion windows change displayed price between observations

**Status:** explained, monitoring only (not a defect in this integration).

Three SKUs initially looked like price-projection mismatches (`232936`, `333450`,
`283165`). Root cause: they are time-boxed promotions (e.g. flash sale 14:00–16:00).
Search/list price and product-detail price were observed at different times, so they
disagreed legitimately.

Re-observed in a single live session (same delivery context): `232936` = 42.315 đ
(list 45.500 đ), `333450` = 12.341 đ (list 14.000 đ) — consistent, whole-VND.

**Related defect fixed:** the detail projection previously passed through upstream float
noise (e.g. `23799.999999999985`). VND has no sub-unit, so prices are now snapped to
whole VND and re-checked for `price <= list_price` (see `src/product.mjs`).

**Upgrade path:** record `promotion_window` per SKU if promo pricing needs to be
forecast rather than observed.

## KI-5 — Availability remains `unknown` (no inventory quantity exposed)

**Status:** open by design; `can_buy` is a flag, not stock proof.

BHX exposes `isCanBuy` / `can_buy` but no stock count. Every availability verdict is
therefore `unknown` unless the site explicitly disallows purchase (`unavailable`).
Multi-buy ladders (`MUA HỘP THỨ 2 GIÁ 34.000Đ`, `GIẢM 5.000Đ KHI MUA 10 BỊCH`) are
surfaced as raw labels, not modelled.

**Upgrade path:** add a bounded add-to-cart trial per SKU (add → read `total` →
remove → read again) to convert `unknown` into "purchasable, verified" for the specific
quantities tested. Requires owner approval for each live trial because it mutates the
cart.
