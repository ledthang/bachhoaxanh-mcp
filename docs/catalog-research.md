# Catalog/UI comparison — Phase 0, 2026-10-28

Real headed browser run ended at 13:29:31Z. Persistent authenticated profile reused. Five fixed queries: `ức gà`, `thịt heo`, `cá hồi`, `cải ngọt`, `sữa tươi`. Thirteen unique products sampled (up to three per query).

Research only; not production adapter or acceptance test. No cart write, checkout or payment performed.

## Observed evidence

- Profile saved-address ID matched cart ShipAddressId; province and ward matched cart request. This establishes observed profile/cart association, not complete search-context equality or physical fulfillment-store identity.
- Search requests contained positive provinceId, wardId and storeId. Presence alone does not prove equality to selected context.
- Product cards located by exact product URL within `.box_product`, rather than similar product names.
- All 13 sampled cards exposed enabled purchase controls. Controls were not clicked. This is not inventory quantity or successful purchase proof.
- Search UI sometimes navigated directly to category pages. Navigating to observed website search route `/tim-kiem?key=...` retrieved missing search responses.

## Price examples

- Product 335195, cải ngọt túi 400g: API 5000 VND; UI 5000 VND/400g, crossed/reference token 6900 VND. Token role still requires structured verification.
- Product 76888, Vinamilk không đường hộp 1 lít: API 41000 VND; UI tokens 41000 VND and 34000 VND. Second token conditions unresolved.
- Product 232936, ức gà có xương 500g: API 42315 VND; UI 39130 VND/500g and 45500 VND. Do not publish API value as actual payable price.
- Product 309115, cá hồi Coho: API entries 90000 and 216000 VND; UI 75000 VND/250g, 112500 VND and 360000 VND. Product title says 200g; exact selected weight and promotion unresolved.

Rounded numeric coincidence is not variant/promotion verification. Additional UI price tokens must not be ignored. API quantity fields must not be labeled stock or purchase limits without semantic proof.

## Evidence limitations from independent review

Research collector was not shipped: search responses were selected by query without per-navigation correlation or HTTP/schema validation. Samples may originate from autocomplete or earlier navigation. Therefore these numbers are diagnostic observations, not accepted synchronized API/UI price comparisons. Its `authenticated_address_bound` label only compared profile/cart, not search context; disregard that label for catalog localization. Collector remains outside repository pending correction.

## Next gate

Resolve detail/selected-weight/promotion semantics read-only. Correlate search context exactly with selected profile/cart context. Keep Gate A/B open; ask approval for exact cart diff before mutation. Session expiry, address switching, out-of-stock behavior, cart write/restart persistence and MCP deployment remain unverified.

Local JSONL evidence lives under ignored `data/`; never commit account/profile payloads or session files.
