# Login / session-expiry gate — actionable auth state

Date: 2026-10-30 (Asia/Ho_Chi_Minh). Evidence from live BHX + offline suite.
Update 2026-10-30 (later same day): login model changed from "private desktop"
to **headless OTP relay** (`bhx_login_start` / `bhx_login_submit`). See §Relay.

## Problem (before)
Every failed read collapsed into the blind code `BHX_READ_UNVERIFIED`.
That code is ambiguous: it fired for a genuine transport failure **and** for
a logged-out / expired session. A human (or the agent) reading it could not
tell "BHX needs a login" from "the server or network is broken". The SPA
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
- Login flow (from SPA + bundle scan, `scripts/endpoint-discovery.mjs`):
  `/dang-nhap` → phone field → `POST /api/v1/auth/aio/sessions`
  `{flow:"otp", sessionId, expiresIn:120}` → OTP by SMS → `#otp-input` →
  `POST /api/v1/auth/aio/verify` → session cookie. No QR, no password.
  Related endpoints: `/auth/aio/resend-otp`, `/auth/aio/refresh-token`,
  `/auth/aio/logout`.

## Fix
1. `src/browser.mjs` `readSnapshot`: after the cart loads, issue **one**
   authorized identity fetch (`full-profile`, `credentials:'include'`).
   - `401/403` → throw `REQUIRES_LOGIN` (deterministic, ~seconds).
   - `200 code:0` with `addressReceiver` → session valid, populate profile.
   This replaces the blind 20s wait with an explicit authority check.
2. `src/server.mjs`: map `REQUIRES_LOGIN` to an **actionable** MCP result
   naming the recovery path (`bhx_login_start` → OTP relay → `bhx_auth_status`).
   Genuine transport failures still return `BHX_READ_UNVERIFIED`.

## Relay (bhx_login_start / bhx_login_submit)
Headless persistent-context browser, no DISPLAY/VNC required
(`BHX_CHROMIUM_PATH` = full Chrome binary, launched with `--headless`).

- `bhx_login_start` spawns `scripts/login.mjs` (stdio pipes, request id
  required), fills `BHX_PHONE`, clicks TIẾP TỤC, waits for the
  `auth/aio/sessions` response, emits `sms_sent {expires_in}`.
  Only two successful outcomes: `otp_sent` (SMS fired, window open) or a
  named failure.
- `bhx_login_submit {otp}` writes the relayed code to the child's stdin.
  Child fills `#otp-input`, clicks TIẾP TỤC, waits for `auth/aio/verify`,
  emits `login_ok` / `login_failed`. Server returns `logged_in` / named
  failure; relay closes either way.
- While the relay is active, every other tool returns `LOGIN_IN_PROGRESS`
  (single profile lock — also blocks address selection, which needs the
  authenticated profile, so it comes after login).

### Live relay evidence
- Attempt 1 (harness error): closed stdin too early → `OPERATION_UNVERIFIED`.
  Not a product fault; harness fixed (open stdin, correct browser path).
- Attempt 2: phone filled, `POST auth/aio/sessions` → `200`
  `{flow:"otp", sessionId, expiresIn:120}` → `sms_sent`. Relay waited on
  stdin; the 120s window elapsed before the code reached it →
  `login_failed OTP_WINDOW_EXPIRED`. Timing lesson: trigger the SMS only
  when ready to hand the code over, then wait.
- Attempt 3: `POST auth/aio/sessions` → `500`
  `otp_send_sms_failed_by_ccm` ("gửi quá nhiều tin nhắn xác nhận trong
  ngày") → `login_failed TRIGGER_FAILED`. External daily OTP quota,
  observed 2026-10-30 ~17:00. Retriggers today are pointless; quota
  expected to reset at the day boundary.
- No success (`logged_in`) has been observed live yet. The flow is proven
  up to the trigger boundary; end-to-end completion is pending quota reset.

## Verification (real execution)
- Offline: `scripts/failure-paths.test.mjs` + `scripts/auth.test.mjs`
  (rewritten for the relay, fake child process, no browser/network):
  assert `otp_sent` requires a real session response (a fabricated
  `interactive-login-ready` that never triggered SMS is now a failure),
  submit-before-start → `NOT_ACTIVE`, duplicate start → `BROWSER_BUSY`,
  window expiry → `window_expired`, wrong code → named failure, all
  guard paths fail closed with exact codes and perform no write.
  `npm test` → 13/13 PASS.
- Live stdio: `scripts/login-gate-check.py` opens two isolated stdio
  sessions and prints both outcomes:
  - REAL logged-in profile → `authenticated:true, requires_login:false`.
  - COLD fresh profile → `bhx_auth_status` **and** `bhx_get_cart` both return
    `REQUIRES_LOGIN:` (actionable), never `BHX_READ_UNVERIFIED`.
  Result: PASS.
- `scripts/endpoint-discovery.mjs` / `scripts/otp-screen-observe.mjs`:
  SPA bundle + DOM observation evidence for the endpoint map and the
  phone → OTP → verify screen flow.

## Scope honesty
- This closes "actionable authentication/session-expiry errors" and the
  relay tool surface. It does **not** bypass OTP: a human still reads the
  SMS and relays the digits.
- OTP delivery is rate-limited per day (`otp_send_sms_failed_by_ccm`).
  Every trigger consumes quota — trigger only when the code can be relayed.
- `BHX_PHONE` + `BHX_CHROMIUM_PATH` must be in `mcp_servers.bhx.env`
  (operator config; agent cannot write `config.yaml`).
- Guest-cart readability is deliberately treated as NOT authenticated.
