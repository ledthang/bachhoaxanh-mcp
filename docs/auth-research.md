# Authentication research

Read-only, before OTP submission. No phone entered, SMS requested, login submitted, or cart/address/order/payment changed.

## Executed host evidence

Fresh, nonpersistent Chromium context opened `https://www.bachhoaxanh.com/dang-nhap` successfully. Visible `input[name="phone"]` count: 1. Separate persistent-profile inspection observed a same-origin `/dang-nhap` link, phone input and `Tiếp tục` button. No input values were read or logged.

Fresh-context research downloaded 50 public HTTPS JavaScript assets into ignored `data/auth-assets/`. No session credentials were exported. Executor-side curl failed DNS resolution; host browser fetch succeeded. Network failure in executor is not evidence that website is unavailable.

Public sources inspected:

- https://bhxcdn.vn/bhx/product-fe/cart/home/_next/static/chunks/app/dang-nhap/page-bc130af56c812f51.js
- https://bhxcdn.vn/bhx/product-fe/cart/home/_next/static/chunks/3117-2abffb90adc42add.js

Observed static code, NOT executed authentication contracts:

- Login page checks customer existence and may retrieve consent before starting authentication.
- Feature-dependent branches call `createAioSession` or `LoginWithPasswordApi`.
- Legacy branch includes device identity, phone, SMS flag and a token argument.
- CAPTCHA generation/display branch exists. This does not prove every login requires CAPTCHA.
- AIO branch includes session creation, resend, verify and token conversion functions.
- Successful legacy handling expects access/refresh tokens and device state. No actual token values were inspected or emitted.

No OTP/auth endpoint was invoked. API-only login, CAPTCHA conditions, token refresh and cross-browser session transfer remain UNVERIFIED. Public function definitions are research leads, not working integration proof.

## Decision

Do not ship a guessed standalone phone/OTP form. Preserve BHX's real browser flow until both feature branches and protection requirements are verified. A phone-friendly remote browser is a fallback design, not implemented or exposed. Any remotely accessible login surface needs explicit deployment topology, HTTPS, access control, bounded lifetime and no credential logging before use.

Next verification requiring user: real OTP/CAPTCHA entry directly in a protected browser surface. No OTP should enter chat or model context. Merely logging into BHX in a separate phone browser does not establish server-side MCP authentication.

## Session diagnostics

Collector marks correlated profile HTTP 401/403 as `AUTH_REQUIRED` (access rejected), not proof of expiry. A 403 may also be a site restriction; diagnosis must not bypass it. Profile `isSuccess: false` without verified error contract remains `PROFILE_SCHEMA_INVALID`.

Absent profile/cart at deadline remains `CAPTURE_TIMEOUT`; timeout alone never means expired session. Timeout diagnostics contain fixed observation booleans only. Request failure remains `NETWORK_FAILED`; JSON/schema/context failures stay distinct. Offline tests exercise these branches, not live session expiry.

No complete MCP or login web service added. Cart POC remains untracked and unshipped.
