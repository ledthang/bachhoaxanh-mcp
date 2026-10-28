# BHX MCP

Phase 0 research only. Not a functional MCP server. See [specification](IMPLEMENTATION_SPEC.md) and [feasibility](docs/feasibility.md). No checkout/payment tools exist.

Offline checks: `node scripts/check.mjs` (not authenticated integration tests).

Research observer is not shipped: initial prototype had overly broad diagnostic output and unreliable UI/variant correlation. Sanitized findings retained in docs; replace observer before further automated research.

## Interactive login POC

Node >=22 required. `npm ci --ignore-scripts`; install matching Chromium with `npx playwright install chromium` if not using an existing compatible browser. On local graphical Linux desktop, run `npm run login`. Optional `BHX_CHROMIUM_PATH` selects existing executable; `BHX_PROFILE_DIR` selects restricted profile outside repository. Default profile: `~/.local/share/bhx-mcp/profile` (0700).

Current research host has headed Playwright browser on display :91. VNC port 5907 is loopback-only. From user's own machine with authorized SSH access:

```sh
ssh -N -L 5907:127.0.0.1:5907 USER@LAN_IP
```

Connect VNC client to `127.0.0.1:5907`. Enter credentials/OTP directly into BHX, never into chat. VNC has no separate password and MUST remain loopback-only behind SSH; never forward/bind to public or LAN interfaces. Do not share tunnel or authenticated desktop. No browser debugging endpoint required.

Login browser currently runs via `DISPLAY=:91 BHX_CHROMIUM_PATH=/path/to/chrome npm run login`. This is temporary research infrastructure, not production deployment. Close browser to stop login POC. Re-run same command/profile for reauthentication. Authenticated profile retrieval and selected delivery state survived browser/process restart in Phase 0; expiry, reauthentication and MCP lifecycle remain unverified.

No MCP registered. Production Compose, tool discovery and authenticated smoke tests deferred until feasibility gates pass. Do not treat a dependency install or login browser as completed integration.
