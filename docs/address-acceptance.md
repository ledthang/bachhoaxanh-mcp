# Saved-address selection evidence

Status: partial, not general address switching.

Real authenticated browser observation on 2026-10-30:
- Account has one saved address; empty active/inactive cart projection.
- Opened native saved-address UI, selected existing entry, confirmed.
- Observed POST `/gw/cart/api/OrderV2/SelectProfile` with exact guard. Unknown fields, multiple sends, cart writes and checkout stay blocked.
- Result acknowledged with HTTP 200 and `ResultCode: 0`.
- Closed browser, opened fresh authenticated snapshot. Same address/province/ward/store context; cart remained empty.
- Runtime `selectAddress` repeated this real operation and returned `selection_status: selected-and-restarted`, `restart_verified: true`.

Request contract: selected saved-address coordinates, district and address ID; current cart ID and current outer province/ward/store context. Inner `ProfileDetailIds` empty. Outer district comes from saved address, not cart-read district (which may be zero).

Limit: same single saved address only. A second saved address is required to establish cross-address store changes, repricing, persistence and restoration. No new address is fabricated or added to the account. Nonempty cart address changes blocked pending protection evidence. Full Phase 0/1 remains incomplete.
