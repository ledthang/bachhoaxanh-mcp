# First real cart trial — incomplete

A bounded, separately approved trial targeted product 335195, quantity 1, initially empty authenticated cart, selected-address/request/store context equality, and product-page primary price 5,000 VND. No checkout or payment.

## Observed

- Abort-only preflight previously passed.
- Website-generated Add was forwarded once. Trial stopped when response failed strict expected-price/line validation.
- Subsequent independent cart read observed one target product, quantity 1, `Price: 6900`, `Total: 6900`. This differs from the previously observed product-page primary price of 5,000 VND. Promotion/variant eligibility and cause remain unresolved; do not label either value guaranteed payable price.
- Later reads placed the sole target in `GroupCartOff.ListCartItemBuy`; `GroupSOStep2InCart` was null and cart total zero. Zero total or null active group alone does not prove empty cart.
- Exact-line removal via website UI required confirmation `Đồng ý`. Actual Remove body included nested `data.wardId` in addition to public-source builder fields. Recovery validated target product, quantity, GUID, cart identity and context; only exact Remove was forwarded.
- Remove succeeded. Reload read verified empty cart; independent browser restart then observed `TotalItemShow: 0`, authenticated profile and selected-address/province/ward/store equality.

## Follow-up read-only evidence

- Product-detail HTTP 200 returned target `data.id: 335195`, one observed box-buy price entry with `price: 5000`, `sysPrice: 6900`, `discountPercent: 28`, `type: 1`, `status: 1`; box-buy `type: 1`, `scenario: 0`.
- A fresh website-generated Add interception observed `productId: 335195`, `quantity: 1`, `productType: 1`, `scenario: 0`, and empty `listPromotion`. Request was aborted, not forwarded. Authenticated context, empty-cart guard and main product UI price passed in that run.
- These values agree on the observed box-buy type/scenario; no mismatch was found there. This does not establish promotion eligibility or explain the previous cart response. Do not invent promotion IDs or add unobserved request fields to force the catalog price.

## Limits

No quantity-2 update, full restart-persistence cycle with a purchasable line, app synchronization, or completed MCP acceptance. No blind Add retry performed. No order/payment action.

Trial implementation did not handle price rejection cleanup or inactive groups reliably; it was retired outside the repository, not shipped. Existing abort-only tools remain research diagnostics, not permission to enable mutation.

Before another mutation: validate active and inactive collections, capture exact response/request identity, establish selected variant/promotion price semantics, and prove cleanup of a known trial line even on price rejection. A new trial must remain inside explicit product/price/context approval.
