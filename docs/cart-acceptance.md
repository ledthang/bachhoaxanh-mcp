# General cart acceptance

Live authenticated MCP stdio trial completed 2026-10-30 (Asia/Ho_Chi_Minh).
Private request/response evidence remains under ignored `data/cart-preservation-20261029-231428-559892/rpc.jsonl`; never publish account/session identifiers.

Command (requires local authenticated browser profile and Chromium path):

```sh
python3 -B scripts/cart-cycle-run.py --authorize-live-cart-trial --query rau --max-unit-price-vnd 15000
```

Observed sequential results:

- Baseline empty; selected two distinct products from authenticated search: 299256 and 299257, 2,900 VND each.
- Add A quantity 1: verified fresh cart.
- Add B quantity 1: verified A unchanged.
- Update B quantity 2: verified A unchanged.
- Remove B: verified A unchanged.
- Remove A: baseline restored, fresh cart empty, total 0.
- No checkout or payment requests permitted.

Mutation tools accept validated product IDs and quantities, not a hardcoded product. Only lines created and tracked by this MCP process may be updated or removed; baseline lines remain protected. Unknown API writes are aborted. Optional website reads are also aborted unless explicitly allowed, without treating an aborted optional request as an applied mutation. Unexpected OrderV2 mutations remain fatal.

Remove credentials are captured from the native exact-line Remove request **with that request aborted**, then used once by the guarded mutation; no credential values are logged. Cart is refreshed and compared before sending.

Offline regression: `npm test` covers exact mutation payloads, two owned lines, unrelated-line preservation, concurrent-change rejection, and driver stop-on-uncertainty behavior. Failed live runs required separate fresh inspection and exact trial-line cleanup before a new run; the driver never blindly retries or cleans up an uncertain mutation.

This closes the two-product cart preservation trial, not all production gates. Catalog pricing/availability and cross-address limitations remain documented separately.
