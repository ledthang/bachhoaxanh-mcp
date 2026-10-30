# Saved-address selection evidence

Status: **verified** (cross-address) — 2026-10-30.

## Account state during verification

The owner added a second saved address, lifting the single-address block (KI-1):

| address_id | address | ward | store |
| --- | --- | --- | --- |
| 90713515 | 140/30 Nguyễn Chánh | 101462 (Hòa Khánh) | 14524 |
| 110346409 | 205 Trần Phú | 101469 (Hải Châu) | server-resolved → 14509 |

Note: `full-profile` reports `deliveryStoreId: "0"` for the newer entry; the store is
resolved **server-side from the ward** at selection time, not from that field.

## Real picker observation (`scripts/address-picker-probe.mjs`, 2026-10-30)

- Native picker at `/gio-hang` → `#btn_choose_location` renders `.lstProfile > div`:
  exactly **2** entries, each a `label.radio-wrapper` containing a visually-hidden
  `input[type=radio][name=addressReceipt]`.
- **The entry card is the click target.** Clicking the `input[type=radio]` directly times
  out ("element is not visible") because the radio is custom-styled. This was caught live
  and the runtime was corrected before acceptance.
- Captured the real cross-address POST:
  `POST /gw/cart/api/OrderV2/SelectProfile` →
  `{"data":{"CartId":"…","ProfileDetailId":110346409,"wardId":101469,"Lat":16.062…,
  "Lng":108.223…,"ProfileDetailIds":[]},"districtId":10020,"provinceId":1020,
  "storeId":14509,"isNewModel":true}` → HTTP 200, `ResultCode: 0`, `OtherData.StoreId: 14509`.

## Acceptance run (`scripts/address-switch-test.py`, one stdio MCP session)

Baseline: 90713515 selected, store 14524, ward 101462, cart empty.

1. select 110346409 → context **changed**: store 14524 → **14509**, ward 101462 → **101469**, `verified=true`.
2. select 90713515 → context **restored**: store 14524, ward 101462, `verified=true`.
3. Cart remained empty throughout (`items=0`, `total=0`) — no unrelated-line impact.

`RESULT: PASS address-switch changed and restored`.

## Contract now enforced

- Target must be a **saved** entry resolved to exactly one picker row
  (`BHX_ADDRESS_AMBIGUOUS_ENTRY` on a duplicate street label).
- Selection is accepted only if the radio reports `checked` **and** the ack returns
  `HttpCode:200 / ResultCode:0`, then re-verified after a browser restart.
- `storeId` may be **server-resolved** (any positive store), not the caller's current
  store — the earlier guard that demanded current-store equality blocked all real
  switches and was replaced.
- Non-empty cart blocks selection (`BHX_ADDRESS_NONEMPTY_CART`); no checkout is triggered.

## Residual limit

Delivery-context change and persistence are proven on this account. Price localization
per store is **not** claimed here: no product was compared across the two contexts in
this run. Unit-test coverage: `scripts/delivery.test.mjs` (cross-address switch reports
`changed:true`; already-selected returns `changed:false`).
