# Phase 0 feasibility — 2026-10-28

Status: **revised 2026-10-30**. The MCP stdio server and guarded cart adapter ARE
implemented, registered in Hermes (`mcp_servers.bhx`) and exercised live; the original
"not implemented" line below is the 2026-10-28 baseline, kept for traceability.
Remaining open gates are listed in [acceptance ledger](phase-acceptance.md).

Update after user login: authenticated profile succeeds after browser/process restart; the account has **two** saved addresses (re-checked 2026-10-30 via `bhx_list_addresses`; the earlier "one saved address" note is obsolete — a second entry, `110346409` / 205 Trần Phú / ward 101469, now exists and cross-address switching was verified with it); selected delivery state persists; website cart read succeeds with 0 items and observed context storeId [selected-store]. See [authenticated observations](authenticated-observations.md) and [address acceptance](address-acceptance.md). Earlier pending-login statements below describe initial baseline, not latest state.

## Environment observed

- Linux 6.12.90+deb13.1-amd64; Node v22.23.2; npm 12.0.2.
- Docker 29.5.3; Compose v5.1.4; daemon responds.
- Hermes 0.21.0, local 05f548f3; `hermes mcp list`: no servers configured.
- Installed CLI supports stdio (`--command`, `--args`) and HTTP (`--url`); registration deferred until real implementation passes gates.
- Playwright pinned to 1.64.1 with lockfile. `npm audit --omit=dev`: 0 vulnerabilities. This is not a complete security audit.

## Third-party research

Inspected https://github.com/hoangvu12/bachhoaxanh-skill at eff6a8383bab9685bcf83a1b2cdfa9301127064c (README, package.json, scripts/bhx.mjs and repository tree).

- README/package declare MIT; no LICENSE file in inspected tree; GitHub licenseInfo null. No third-party implementation copied. License grant should be clarified before reuse.
- Package declares no npm dependencies. CLI imports local `jev.mjs`, offering optional external TypeSafe product selection. Not needed here; not incorporated. Full dependency/transitive and helper audit remains open.
- Contrary to README's usage section, source also contains cart read/add commands. These are research leads, not verified BHX contracts.
- Source falls back to store 2546 and province 1027. Such defaults cannot establish user's fulfillment context.
- `auth` checks cookie presence/flags, not server-confirmed account identity.
- Session file writes lack explicit restrictive modes; errors can print response bodies. Do not reuse these practices.
- Cart getter can mint a fresh cart with blank cart ID; persisted local ID does not establish website/app synchronization.
- Generic request helper retries after auth failures, including mutations. Do not copy blind mutation replay.
- Exact stock, saved-address selection, localized account pricing, cart update/remove and cross-device persistence not established.

## Live observations

1. Direct `curl -I https://www.bachhoaxanh.com/` returned HTTP 403. No repeated fetch hammering, CAPTCHA bypass, stealth flags or anti-bot evasion used.
2. Normal cached Chromium headless launch rendered BHX home with expected title, visible login link `/dang-nhap`, and delivery selector `#btn_choose_location` showing `Chọn vị trí giao gần bạn`.
3. Guest page bootstrap contained provinceId 1027 / storeId 2546. This is guest/default data ONLY, never user's fulfillment store.
4. Headed Playwright persistent context launched on local research display :91; `scripts/login.mjs` emitted `login_browser_ready`, authentication `not_verified`.
5. Profile outside repo has mode 0700. No cookies, tokens, request headers/bodies, screenshots or account text logged by login script.
6. Research VNC listens only on loopback port 5907; TCP greeting verified as RFB 003.008. Access requires SSH tunnel. No browser debugging endpoint exposed.

## Initial pre-login capability matrix (historical)

“Unsupported (unverified)” below means not established in current POC, NOT proof BHX cannot support it.

| Capability | Status | Evidence / blocker |
|---|---|---|
| Authenticated login | Partially verified | Headed login browser ready; user login pending |
| Persistent session | Unsupported (unverified) | Persistent profile created; authenticated restart test pending |
| Saved addresses | Unsupported (unverified) | Requires authorized authenticated session |
| Delivery context | Unsupported (unverified) | Guest selector observed; authenticated assignment unknown |
| Localized pricing | Unsupported (unverified) | Gate A blocked on login/address |
| Localized availability | Unsupported (unverified) | No purchasability claim from guest catalog |
| Cart read | Unsupported (unverified) | No authorized account cart read yet |
| Cart add | Unsupported (unverified) | Gate A plus explicit mutation approval required |
| Cart update | Unsupported (unverified) | No mutation performed |
| Cart remove | Unsupported (unverified) | No mutation performed |
| Cart persistence | Unsupported (unverified) | Requires approved read/write/reload sequence |

## Next evidence required (current)

Login/profile restart and saved-address retrieval observed. Next: safely correlate selected address to context and compare 3–5 products against exact UI product/variant/promotion. Replace retired research observer before continuing. Do not build production cart adapter before Gate A. Present exact test-cart diff and obtain approval before mutations. Verify reload/restart persistence and ask user to check app when possible. Expand catalog comparisons to 10 products before final acceptance.

Authenticated profile and empty website cart reads observed; catalog values remain UI-unverified. No verified inventory counts, physical fulfillment warehouse, cart mutations, orders or completed integration claimed.
