# Phase 0 and Phase 1 acceptance ledger

Full implementation-spec acceptance is **incomplete**. A working bounded cart trial, tool discovery, or headless boot does not close either phase.

Baseline audited: `0a7b56b746d3d76ff6d3c988c530a7cc15adc05d`.

## Verified baseline

- Interactive browser login and persistent authenticated browser profile.
- Saved-address reads and profile/cart delivery-context correlation.
- Real MCP stdio initialization and discovery of 13 tools (verified again 2026-10-30 via `scripts/tools-list-check.py`; no checkout/payment tool present).
- Headless authenticated cart read without DISPLAY.
- Historical live evidence: bounded product `335195` Add 1, Update 2, read-after-write, exact-line Remove and fresh empty-cart verification.
- Live two-product preservation/restoration trial: **verified** 2026-10-30 (see `docs/cart-acceptance.md`). Baseline empty → add 299256 → add 299257 → update 299257 qty 2 (299256 untouched) → remove 299257 (299256 untouched) → remove 299256 → empty baseline restored.
- Earlier browser-restart persistence and container bounded-cart cycle.
- No checkout/payment tools. Existing lines are immutable preservation targets; only exact process-owned lines may be updated or removed.

These results prove historical bounded behavior plus the two-product multi-item preservation trial; they do not establish address switching, inventory guarantees or mobile-app sync.

## Remaining acceptance gates

- [x] Generic product detail lookup from authenticated observed catalog routes; bounded ID restriction removed. Price/stock guarantees remain incomplete.
- [ ] Normalized package, price, promotion, variant and availability information; unknown values preserved.
- [x] Ten distinct representative products compared against authenticated website, timestamped sanitized evidence. 12 products compared (see `docs/catalog-acceptance.md`); all verdicts remain **partial** because stock/promotion eligibility is unknown and 3 rows show API-vs-website price mismatch.
- [ ] Observed availability semantics documented; search appearance and numeric quantity fields never treated as inventory proof.
- [x] Saved-address selection tool, verified context change, persistence and restoration. Cross-address cycle verified 2026-10-30: 90713515 (store 14524/ward 101462) → 110346409 (store 14509/ward 101469) → restored, cart empty throughout (`docs/address-acceptance.md`, `scripts/address-switch-test.py`). Per-store price localization still not compared.
- [ ] Interactive login MCP tool and actionable authentication/session-expiry errors.
- [x] General cart operations with precise baseline diff, unrelated-item preservation and verified persistence. Live two-product cycle verified 2026-10-30 (`docs/cart-acceptance.md`).
- [ ] Failure-path regression coverage and independent current-snapshot review.
- [ ] Feasibility, README and operational docs match implemented and verified scope.

Mobile-app synchronization remains unverified. The specification requests this check if possible; website persistence must still be proved independently.

No gate is marked complete solely on an executor report, static test, or guessed site contract. Update each checkbox only after independently checking its artifact and corresponding real execution evidence.
