# Cart preflight — Phase 0

Not a functional MCP server or completed cart integration.

Run headed with the existing restricted persistent profile:

```sh
node scripts/cart-poc.mjs
node scripts/cart-cycle.mjs
node scripts/cart-poc.test.mjs
node scripts/cart-cycle.test.mjs
```

`cart-poc.mjs` writes sanitized ignored evidence to `data/cart-discovery.json` using exclusive creation. Archive existing evidence before another run.

`cart-cycle.mjs` is named for future cycle research but currently performs **abort-only Add preflight**. It never forwards Add. No mutation-enabling option exists.

Historical preflight reported a pass, but later investigation found it blocked `GetPopupProduct`, a purchase prerequisite whose failure can trigger website fallback Add. That historical pass does **not** establish an intact purchase/promotion flow. Guard now allows only the observed main-frame GET while armed, with exact product, province/ward/store and query flags; malformed or mismatched popup reads fail closed. A fresh live abort-only run passed with this read allowed. This remains a request-shape diagnostic, not proof of promotion eligibility or payable cart price.

Historical observations: authenticated selected-address/cart/request context equality, empty cart contract, main product UI price 5,000 VND, product 335195 and quantity 1 in the website-generated Add request. Request was aborted before transmission. Empty contract observed `GroupSOStep2InCart: null`, `TotalItemShow: 0`, `CartTotal.Total: 0`. Nonempty line schema remains unverified.

Main purchase control is inside the direct `div.px-9px` child of the unique product heading region; related-product buttons are excluded. Static assets are restricted to observed CDN origins/path without query parameters. Site-owned session refresh is allowed separately; login/OTP/logout and cart/order/payment mutations remain blocked. Refresh allowance is not proof of session longevity.

Outstanding: real Add response and cart line/price verification, restart persistence, quantity update, exact trial-line removal, restoration and app synchronization. No order placement or payment is permitted.
