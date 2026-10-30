# BHX MCP stdio server - ONE lazy live browser session parked on /gio-hang, one shared request guard.

The session is the trust boundary. Every call goes through `request()`, which allows only
the exact URLs the BHX SPA itself calls, from the parked cart page, and records every
request the page makes (`observed`). Anything a tool sends that was not already observed
from the page itself is aborted (`POLICY_BLOCKED`), so a tool cannot invent a call.
Auth is derived from live responses, never assumed: `code 99` / `401` => `REQUIRES_LOGIN`.
Cart context (cartId + delivery context) is taken from the page's own localStorage, which
the SPA writes after `OrderV2/get` - the same source the SPA reads from.

```
src/server.mjs    JSON-RPC over stdio; tool surface; maps tool args -> session calls
src/session.mjs   the live page: launch/park, allow-list, request(), cart + auth + addresses
src/profile.mjs   single source of truth for the persistent profile directory
src/auth.mjs      detached OTP relay (bhx_login_start / bhx_login_submit)
scripts/          probes + acceptance tests (stdio-level, run against the real server)
```

## Cart ownership model (why some calls need `user_authorized`)

BHX carts can hold lines that were added by the shopper outside this integration. Those
lines are **preservation targets**: this integration must never remove them by accident.

- `bhx_add_to_cart` adds exactly one line and verifies it appears with the requested
  quantity and a price at or below the caller's ceiling.
- `bhx_update_cart_item` / `bhx_remove_cart_item` address a line by `line_id`. The tool
  refuses unknown `line_id` (`LINE_NOT_FOUND`). Touching a line that this process did not
  create requires `user_authorized: true` (`AUTHORIZATION_REQUIRED`) - an explicit,
  per-call acknowledgement that the caller means it.
- `bhx_check_availability` runs a bounded add -> verify -> remove -> verify trial per SKU
  and leaves the cart as it found it.
- `bhx_checkout_preview` reads /thanh-toan text only; `Đặt hàng` is never clicked, so no
  payment can be initiated by this server.

## Session lifecycle

`ensureParked()` on first use; the page stays on /gio-hang between calls (no reload per
call - reloading is what previously produced `code 99` and mis-attributed cart state).
On reload, only cart navigation is allowed; other URLs are aborted so a stray subresource
cannot re-trigger a write.

## Known limits

Stock is never proven by search appearance; `can_buy` is a flag. Prices are
catalog-observed, payable only after the cart/checkout read that produced them.
