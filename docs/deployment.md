# Deployment

BHX MCP is an MCP **stdio** server. There is **no HTTP endpoint** and **no port to
open**. The MCP client (Hermes) spawns `node src/server.mjs` and talks JSON-RPC over
stdin/stdout. Everything below follows from that fact.

## Deployment modes

### A. Hermes-native (current, verified)

Hermes spawns the server directly from the host checkout. This is what is live now.

`~/.hermes/config.yaml`:

```yaml
mcp_servers:
  bhx:
    command: /usr/bin/node
    args:
      - /home/openclaw/.hermes/workspace/bachhoaxanh-mcp/src/server.mjs
    env:
      BHX_CHROMIUM_PATH: /home/openclaw/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
    connect_timeout: 30.0
    enabled: true
```

- **13 tools**, no checkout/payment tool (verified via `scripts/tools-list-check.py`).
- Persistent browser profile at `~/.local/share/bhx-mcp/profile` (single source of
  truth: `src/profile.mjs`; precedence `BHX_PROFILE_DIR` >
  `BHX_RUNTIME_DIR/profile` > `~/.local/share/bhx-mcp/profile`).
- Readiness is proven over **stdio**, not HTTP: `scripts/mcp-read-check.py` runs a
  full session (initialize → tools/list → auth → addresses → delivery → cart) and is
  the canonical health probe. `hermes verify` reads the pinned manifest
  (`.hermes/environment.json`, `start: null` / `port: null`) so it no longer polls a
  non-existent `:8000`.

### B. Docker Compose (supervised)

For running the stdio server under a supervisor with a persistent volume + healthcheck
(used when a non-Hermes stdio client or an operator console needs it). `docker-compose.yml`
is provided.

```
docker compose up -d          # start
docker compose logs -f bhx-mcp
docker inspect --format '{{.State.Health.Status}}' bhx-mcp
```

- Volume `bhx-runtime` -> `/runtime` (profile persists across container restarts).
- `restart: unless-stopped` = automatic restart, per §10.1.
- Healthcheck sends `initialize` over stdio and expects a `result` — there is no HTTP
  route to poll. See `scripts/healthcheck.cjs`.
- **No `ports:`** — a stdio MCP server exposed on a port is meaningless and, if done
  without authentication, violates §10.2.

Build + health-check (verified 2026-10-30, evidence below).

## Login / re-authentication procedure

Login is **interactive and human-operated**. OTP/CAPTCHA are never guessed, never
bypassed (§10.2: no CAPTCHA bypass, no anti-bot evasion).

1. Start the interactive login browser:
   - Host: `npm run login` (spawns headed Chromium on the active display), or under
     noVNC: `DISPLAY=:91 <login command>` with the noVNC client at `:6080`.
   - The persistent profile directory is used, so cookies/session survive restarts
     while valid.
2. In the browser, sign in to `bachhoaxanh.com` (phone + OTP, entered by a human).
3. Close the browser. The profile now holds a valid session.
4. Verify over stdio: `scripts/mcp-read-check.py` →
   `auth_status: authenticated=True, session_status=valid`.

**Re-authentication:** when the session expires, reads return
`BHX_READ_UNVERIFIED` (fail-closed — no mutation happens on an unverified read).
Re-run the login procedure above. A container restart alone does **not** re-authenticate;
it preserves an already-valid session via the profile volume.

## Secret handling (§10.2)

Never committed (`.gitignore` covers all of it): `.env`, `cookies*`, browser profiles
(`profiles/`, `~/.local/share/bhx-mcp/`), session data, HAR captures (`*.har`), logs
(`*.log`), database files (`*.db`). Phone number and OTP stay in the operator's head or
`.env`; only sanitized statuses are surfaced by the tools.

## Build + health-check evidence (2026-10-30)

- `docker build -t bhx-mcp:local .` → succeeded (image tagged; `FROM
  mcr.microsoft.com/playwright:v1.64.1-noble`, `npm ci --omit=dev`).
- `docker run --rm bhx-mcp:local node scripts/healthcheck.cjs` → MCP stdio handshake
  over the container: `mcp_tools_count: 13`, `checkout_or_payment_present: false`,
  exit 0.
- One earlier build failed on a transient `mcr.microsoft.com` EOF; retry succeeded. Not
  a code issue.
