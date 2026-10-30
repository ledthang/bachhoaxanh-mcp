# BHX MCP

Authenticated Bach Hoa Xanh MCP server over stdio, integrated with Hermes (`mcp_servers.bhx`). Guarded cart mutations only — **no checkout, no payment, no order placement** anywhere in this codebase.

## Status (2026-10-30)

Working and integrated, **not production-ready**. Do not treat any section below as full spec acceptance; see [acceptance ledger](docs/phase-acceptance.md).

| Area | State |
|---|---|
| MCP stdio init + discovery of 13 tools | verified |
| Interactive login tool, persistent authenticated profile | verified |
| Saved addresses, delivery context, cart read/summary | verified |
| Product search + generic product detail | verified (partial: stock/promotion semantics unknown) |
| Two-product live cart cycle with unrelated-item preservation | verified |
| Cross-address switching (context change + persistence + restore) | verified 2026-10-30 |
| Per-store price localization, inventory guarantees, mobile-app sync | **not verified** |

No checkout or payment tool exists, and the request allowlist refuses those routes.

## Requirements

Node >= 22, Playwright 1.64.1 (`npm ci --ignore-scripts`), and a Chromium executable. Set `BHX_CHROMIUM_PATH` if Playwright's default path is not used. `BHX_PROFILE_DIR` selects the persistent profile (default `~/.local/share/bhx-mcp/profile`, mode 0700). Never commit profile/session/cookie files.

## Running

```sh
npm start          # MCP stdio server
npm run login      # interactive login (headed browser; OTP/CAPTCHA are human-operated)
npm test           # offline regression suites (no network, no browser)
npm run cart-live  # authorized live cart trial driver (see docs/cart-acceptance.md)
npm run evidence   # structured evidence run (see scripts/evidence-run.py)
```

Register in Hermes as an stdio server pointing at `src/server.mjs`; `scripts/tools-list-check.py` exercises init + `tools/list` locally.

## Safety model

- Every mutation needs exact arguments plus explicit `user_authorized: true`.
- Add requires a recent authenticated search observation in the same process, an exact product route read, observed variant/context match, price within the caller's ceiling, and no existing line for that product.
- Update/Remove require a process-local ownership handle for an exact line. Restart loses handles.
- Each write takes a fresh before-cart snapshot, guards the exact request/route/context/line, then verifies **only** the intended transition. Any unrelated line, total, identity or context drift stops the session.
- Unknown requests, unexpected HTTP methods, extra sends, ambiguous responses and nonempty-cart address changes fail closed. No automatic retry, no automatic cleanup.
- Private account data stays out of Git: evidence lands in gitignored `data/`, session/cookie/token values are never printed.

## Docs

- [implementation spec](IMPLEMENTATION_SPEC.md)
- [feasibility](docs/feasibility.md)
- [runtime + mutation gates](docs/mcp-runtime.md)
- [acceptance ledger](docs/phase-acceptance.md)
- [cart acceptance](docs/cart-acceptance.md)
- [catalog acceptance](docs/catalog-acceptance.md)
- [address acceptance](docs/address-acceptance.md)
- [failure-path regression + snapshot review](docs/failure-paths.md)
- [per-store price localization](docs/localization.md)
- [login / session-expiry gate (actionable auth state)](docs/login-gate.md)
