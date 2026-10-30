# MCP runtime: guarded cart scope

Run `npm start` with Node >=22. MCP uses newline-delimited JSON-RPC over stdio; stdout contains protocol messages only. Private browser/session files stay outside Git under `$BHX_RUNTIME_DIR/profile` (default `~/.local/share/bhx-mcp/profile`).

Tools cover authenticated reads, product search/detail and cart Add/Update/Remove. No checkout or payment tool exists. Mutation routing permits only exact `Add`, `UpdateCartItem`, `Remove`, cart reads and observed authenticated product reads; unknown requests fail closed.

## Mutation gates

- Every mutation requires exact arguments and explicit `user_authorized:true`.
- Product IDs, quantities and unit-price ceilings must be positive safe integers.
- Add requires a recent authenticated search observation in the same MCP process, fresh exact product/detail route, observed variant/scenario/context, purchase-enabled prices within the caller ceiling, and no existing cart line for that product ID.
- Update and Remove require an exact process-local ownership handle. Multiple runtime-owned lines are supported in one process; restart loses handles.
- Every write captures a fresh before-cart, guards exact operation/body/route/context/product/line/quantity, then verifies only the intended transition. All unrelated active/inactive lines, totals, identity, price and context must remain consistent.
- Complex/duplicate/unknown cart shapes, concurrent changes, ambiguous responses and uncertain outcomes stop the session. No automatic retry or cleanup.

## Verification status

Offline regression tests cover generalized quantities/products, exact request rejection, preexisting-line preservation, two runtime-owned lines, exact cleanup, concurrent-change rejection, and acceptance-driver stop behavior. Earlier live evidence covered only product `335195`, Add 1, Update 2, Remove in an empty cart; it does **not** prove generalized live support.

Generalized two-product preservation was pending at the time of writing; it is now **verified live** on 2026-10-30 — see `docs/cart-acceptance.md` (add 299256 → add 299257 → update 299257 qty 2 with 299256 untouched → remove 299257 → remove 299256 → empty baseline restored). Authorized operator command:

```sh
npm run cart-live -- --authorize-live-cart-trial
```

Driver records raw RPC/stderr evidence under gitignored private `data/cart-preservation-*`, prints sanitized summaries, never touches baseline product IDs, and stops with cleanup-required diagnostics on ambiguity. It never calls checkout/payment routes and never retries or cleans blindly.

Do not call this production-ready. Address mutation with nonempty carts, promotion selection, quantity-specific inventory, mobile-app synchronization and broader acceptance remain unverified.
