# MCP runtime: verified bounded scope

Run `npm start` (Node >=22). MCP uses newline-delimited JSON-RPC over stdio. stdout contains protocol messages only.

Private browser profile: `$BHX_RUNTIME_DIR/profile`, default `~/.local/share/bhx-mcp/profile`. Set `BHX_CHROMIUM_PATH` when Chromium is not installed at Playwright's default path. Login requires the real website; OTP/CAPTCHA remain human-operated. Never commit or share profile/session files.

Nine tools: authentication status, saved addresses (redacted opaque identities), delivery context, cart read/summary, product search, Add, Update, Remove. Search and cart results require authenticated address-specific context. No checkout/payment tool or endpoint is permitted.

## Verified mutation limits

- Only product `335195`; Add quantity 1; Update from 1 to 2; Remove exact runtime-owned line.
- Add requires empty active and inactive cart, explicit authorization, and maximum unit price.
- Existing items are protected. Other products, quantities, and preexisting line edits are rejected.
- Ownership is process-local. Restart loses mutation handles; do not blindly retry uncertain writes.
- On unverified mutation, inspect real cart. No automatic mutation retry or automatic cleanup.

Real stdio client exercised Add 1, Update 2, Remove; all passed. Separate POC verified browser-restart persistence. These do not establish arbitrary-product support or mobile-app sync.

## Docker

```
docker build -t bhx-mcp:local .
docker run --rm -i --init --shm-size=1g \
  --user "$(id -u):$(id -g)" \
  -v "$HOME/.local/share/bhx-mcp:/runtime" \
  bhx-mcp:local
```

Use one process per browser profile. Do not run host browser and container against the same profile concurrently. Image contains code/dependencies only; `.dockerignore` excludes private runtime, data, and repository history. Docker build, initialize/tools-list smoke, and authenticated container cart read passed (empty verified cart). Authenticated container stdio Add 1, Update 2, Remove cycle also passed.

## Incomplete

Not full implementation-spec acceptance: arbitrary-product mutations, richer product/promotion contracts, address selection, mobile-app sync, and complete acceptance suite, including read-after-write in one MCP session, remain unfinished. Do not call this production-ready.
