# Authenticated Phase 0 observations — 2026-10-28

User confirmed direct browser login and delivery selection. Subsequent headed Playwright restarts reused restricted persistent profile.

- Profile endpoint observed from actual website: `/gw/bhx-api-identity/api/v1/profile/full-profile`.
- Server response: HTTP 200, `isSuccess: true`, nonempty account identity/name (values never logged), `addressReceiver` length 2.
- Address schema includes `addressId`, `provinceId`, `wardId`, `districtId`, `deliveryStoreId` (first observed value null). No complete address or account identifiers retained in evidence.
- Restarted UI no longer has login link; delivery selector no longer shows unselected prompt.
- Actual website cart request: `/gw/cart/api/OrderV2/get`; response HTTP 200, `HttpCode: 200`, `ResultCode: 0`, `TotalItemShow: 0`.
- Cart request context: provinceId [selected-province], wardId [selected-ward], districtId 0, storeId [selected-store].
- Cart response: `StoreId: [selected-store]`, `LogisticStoreId: 0`, nonzero `ShipAddressId` (value withheld).
- Zero LogisticStoreId is not proof of fulfillment-center identity. StoreId [selected-store] is observed website/cart context, not independently established physical fulfillment warehouse.
- Browser automatically requested `/gw/cart/api/OrderV2/CheckValidateCart`; no programmatic add/update/remove performed.

Verified: authenticated profile retrieval after browser/process restart; saved address list exists; selected delivery state persists; authenticated website cart read. Not yet verified: explicit adapter address selection, expiry/reauth handling, context-to-address identity match, localized catalog UI comparison, cart mutations/persistence/app sync, MCP lifecycle or deployment.

## First catalog observation (not UI-verified)

At 2026-10-28T12:57–12:58Z, website search requests for `ức gà`, `thịt heo`, `cá hồi`, `cải ngọt` carried provinceId [selected-province], wardId [selected-ward] and storeId [selected-store]. Search responses exposed productPrices entries with `price`, `sysPrice`, `status`, `isCanBuy`, `textStatus`.

Examples: product 232936 (`Ức gà có xương 500g`) API price 42315 VND; product 335195 (`Cải ngọt túi 400g`) API price 5000 VND. These are observed catalog values, NOT verified cart prices or purchase guarantees. Inventory count remains unknown.

Initial exact-name UI matcher is insufficient: many names not matched, and one broad-name match found a flash-sale card showing 39130 VND/500g while API candidate had multiple price entries. This does NOT prove a same-variant price mismatch: card identity/variant and promotion binding are not established. Do not pick first price or mark `ui-matched`. Milk observation had empty request context and cannot be counted as address-bound proof. Tighten endpoint, query and product-card correlation before acceptance.

First search run failed due duplicate `#input_open_search` IDs on BHX page. Visible-first selector fixed that crash; second run completed five query observations but UI verification still incomplete. Syntax, diff checks and npm audit passed; no integration suite claim.

Gate A and Gate B remain open. No order or payment action performed.
