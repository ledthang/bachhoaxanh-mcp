# Failure-path regression + current-snapshot review — 2026-10-30

Two things: (1) every failure must fail **closed** with an exact code and perform **no
write**; (2) the docs/status must be re-checked against a **live current** snapshot, not
an old one.

## 1. Failure-path regression (`scripts/failure-paths.test.mjs`, offline)

Fakes only — no browser, no network. Runs in the `npm test` chain (now 13 suites, all PASS).

**Address selection (apply must not run, or run at most once, never leak a write):**

| Path | Code asserted | Side effect |
| --- | --- | --- |
| snapshot read throws | `BHX_AUTH_CONTEXT_REQUIRED` | none |
| target id not saved | `BHX_ADDRESS_NOT_SAVED` | apply not run |
| duplicate rows for one id | `BHX_ADDRESS_NOT_SAVED` | apply not run |
| nonempty cart | `BHX_ADDRESS_NONEMPTY_CART` | apply not run |
| context `verified:false` | `BHX_DELIVERY_CONTEXT_UNVERIFIED` | apply not run |
| two rows flagged selected | `BHX_DELIVERY_CONTEXT_UNVERIFIED` | apply not run |
| restart snapshot throws | `BHX_ADDRESS_RESTART_UNVERIFIED` | — |
| restart cart gained a line | `BHX_ADDRESS_CART_CHANGED` | — |
| context shows another address | `BHX_DELIVERY_CONTEXT_CHANGED` | — |
| invalid input shapes | `INVALID_ADDRESS_ID` | snapshot not even read |

**Request contract (`selectionAllowed`)** — rejects wrong url (`…/Add`), GET, missing
address baseline, extra top-level field, missing/false `isNewModel`, wrong ward/province/
district, `storeId` 0/negative/non-integer, wrong cartId, wrong `ProfileDetailId`,
nonempty `ProfileDetailIds`, inner ward mismatch, inner extra field, non-finite lat/lng.

**MCP layer** — call-before-initialize `-32000`; unknown method `-32601`; unknown tool
`-32602`; bad protocol `-32600`; id-less (notification) mutation `-32600` with **no
session created**; `user_authorized` absent or `false` → `-32602`, **no session created**;
unverified mutation → `…cleanup_required`, **exactly one attempt (no blind retry)**;
login browser active blocks both address change (`BROWSER_BUSY`) and cart read
(`LOGIN_IN_PROGRESS`); search query blank / >100 chars / control chars → `-32602`
before any browser; product/availability argument shape failures → `-32602`.

**Honest note:** the failures surfaced while *building* the suite were fixture-authoring
mistakes (an internally contradictory snapshot, a bad URL entry), not product defects. The
code failed closed correctly throughout; this suite locks that behavior in so a future
change cannot silently open a path.

## 2. Independent current-snapshot review (live, 2026-10-30 17:13 +07)

Fresh stdio session (none of the offline suites touch the browser), via
`scripts/mcp-read-check.py` + `scripts/tools-list-check.py`:

- `initialize` ok → protocol `2024-11-05`, server `bhx-mcp 0.1.0`.
- `tools/list` → **13 tools**; **no** checkout/payment/order/submit tool.
- Annotations cross-checked against the docs:
  - reads (`auth_status`, `list_addresses`, `get_delivery_context`, `get_cart`,
    `cart_summary`, `search_products`, `get_product`, `check_availability`):
    `readOnlyHint=true, destructiveHint=false` — matches "read authenticated state".
  - mutations (`add/update/remove_cart_item`): `readOnlyHint=false`,
    `destructiveHint=true`, `idempotentHint=false` — matches "one attempt, no auto-retry".
  - `bhx_login_start`: `readOnlyHint=false, destructiveHint=false` — opens a browser,
    writes no cart.
  - `bhx_select_address`: `destructiveHint=true` — changes account delivery context,
    consistent with the empty-cart guard.
- Live auth `authenticated=true, session_status=valid`; **2** addresses, exactly **1**
  selected (HOME 90713515, store 14524, ward 101462); cart empty (0 / 0đ).

Docs reconciled against this snapshot: README and feasibility no longer claim "one saved
address" or "no MCP implemented"; cross-address switching marked verified, while per-store
price localization, inventory guarantees and mobile-app sync remain explicitly **not
verified**.

## Residual

- `idempotentHint` left unset on the non-read tools (MCP leaves it optional; not asserting
  idempotency is the safe choice — a repeat add for an existing product is refused, not
  silently absorbed).
- Real checkout is still never exercised (no tool exposes it by design).
