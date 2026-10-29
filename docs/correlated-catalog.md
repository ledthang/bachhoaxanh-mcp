# Correlated catalog research

Phase 0 diagnostic evidence, not production acceptance.

Two fresh read-only browser runs completed successfully after replacing the retired collector. Latest run: five queries, thirteen unique product cards, thirteen exact product-path matches, nine exact numeric API-price token matches. Counts computed from ignored local JSONL, not inferred from console excerpts.

Every captured search request matched validated profile/cart delivery context (province, ward and store). Saved address ID matched cart address ID. Identifiers stayed in memory; output contains only comparison booleans and projected catalog fields. This proves observed request context association, not physical warehouse identity, stock quantity, or payable cart price.

API-price token matches are deliberately strict numeric comparisons. Decimal API values may differ from rounded UI display. A token match does not establish selected weight, promotion conditions or checkout price.

## Detail-page inspection

A separate read-only headed browser inspection successfully opened:

- `/thit-ga/uc-ga-co-xuong-tui-500g`: heading `Ức gà có xương 500g`, primary displayed price `39.130₫`, primary crossed price `45.500₫`, visible `Flash sale` label and remaining-time/allocation text. No purchase control clicked. This supports a promotion-related discrepancy with search API price 42315; exact promotion API binding remains unresolved.
- `/rau-sach/cai-ngot-tui-400gr`: heading `Cải ngọt túi 400g`, primary displayed price `5.000₫`, primary crossed price `6.900₫`.

Observed catalog routes (paths only): `/gw/Product/GetProductDetail`, `/gw/Product/GetGalleryProduct`, `/gw/Product/GetProductRelative`, `/gw/Product/GetlstProductBuyTogether`. These are research leads, not verified adapter contracts.

Detail inspection did not independently correlate account/context again; do not count these two pages as full localized-detail acceptance. Earlier executor browser startup failed in its sandbox; subsequent primary host execution succeeded. No fabricated fallback used.

## Remaining gates

- Selected-weight and promotion semantics, including actual cart price.
- Address changes, session expiry/reauthentication, unavailable products and quantity limits.
- Approved cart add/update/remove and restart persistence.
- MCP implementation, Hermes integration and Docker deployment.

Gate A/B remain open. No cart mutation, checkout, order or payment performed.
