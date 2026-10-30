# Login / session-expiry gate — actionable auth state

Date: 2026-10-30 (Asia/Ho_Chi_Minh). Evidence from live BHX + offline suite.

## Problem (before)
Every failed read collapsed into the blind code `BHX_READ_UNVERIFIED`.
That code is ambiguous: it fired for a genuine transport failure **and** for
a logged-out / expired session. A human (or the agent) reading it could not
tell " BHX needs a login" from "the server or network is broken". The SPA
never fetches the identity endpoint while anonymous, so a passive wait for
`full-profile` timed out blind.

## Ground truth observed
- `GET api.bachhoaxanh.com/gw/bhx-api-identity/api/v1/profile/full-profile`
  - logged-in persistent profile → `200 {code:0, data.addressReceiver:[...]}`
  - anonymous (cold profile, no cookie) → `403` "Request forbidden by
    administrative rules" (WAF/edge, never reaches JSON)
- Anonymous `/gio-hang` still serves a cart with `ResultCode:0` (a guest
  cart). So a readable cart does **not** prove login. Only `full-profile`
  proves an authenticated session.

## Fix
1. `src/browser.mjs` `readSnapshot`: after the cart loads, issue **one**
   authorized identity fetch (`full-profile`, `credentials:'include'`).
   - `401/403` → throw `REQUIRES_LOGIN` (deterministic, ~seconds).
   - `200 code:0` with `addressReceiver` → session valid, populate profile.
   This replaces the blind 20s wait with an explicit authority check.
2. `src/server.mjs`: map `REQUIRES_LOGIN` to an **actionable** MCP result
   naming the recovery path (`bhx_login_start` → enter credentials/OTP on the
   private desktop → `bhx_auth_status`). Genuine transport failures still
   return `BHX_READ_UNVERIFIED`.

## Verification (real execution)
- Offline: `scripts/failure-paths.test.mjs` asserts the `REQUIRES_LOGIN`
  mapping is actionable, is **not** the blind code, and performs no write.
  `npm test` → 13/13 PASS.
- Live stdio: `scripts/login-gate-check.py` opens two isolated stdio
  sessions and prints both outcomes:
  - REAL logged-in profile → `authenticated:true, requires_login:false`.
  - COLD fresh profile → `bhx_auth_status` **and** `bhx_get_cart` both return
    `REQUIRES_LOGIN:` (actionable), never `BHX_READ_UNVERIFIED`.
  Result: PASS.
- `bhx_login_start` against a private `Xvfb :99` returns
  `interactive-login-ready` (the earlier `OPERATION_UNVERIFIED` was a harness
  mistake — `BHX_CHROMIUM_PATH`/open stdin — not a product fault).

## Scope honesty
- This closes "actionable authentication/session-expiry errors". It does not
  bypass OTP/CAPTCHA; a human still completes login on the private desktop.
- The display for `bhx_login_start` is supplied by the homelab (Xvfb /
  secured VNC). The server itself never runs the login browser headlessly.
- Guest-cart readability is deliberately treated as NOT authenticated.
