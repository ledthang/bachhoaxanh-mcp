# BHX MCP — Implementation & Deployment Specification

**Repository:** `bhx-mcp`
**Status:** Implementation specification
**Date:** 2026-10-28
**Primary client:** Hermes
**Deployment:** Self-hosted Linux / Docker
**Scope:** Bách Hóa Xanh integration only

---

# 1. Mission

Build and deploy a self-hosted Model Context Protocol (MCP) server for Bách Hóa Xanh (BHX).

The MCP server must use the user's **authenticated BHX account and selected delivery address** to:

1. Authenticate and maintain a persistent session.
2. Retrieve saved delivery addresses.
3. Identify the effective fulfillment store or delivery zone.
4. Search products available for the selected address.
5. Retrieve localized prices, promotions, package sizes, and availability.
6. Read and modify the user's shopping cart.
7. Verify that cart modifications persist and are visible on the BHX website or app.

The user will review the prepared cart and manually complete checkout.

**Never implement automatic order placement or payment.**

## 1.1 Non-negotiable requirement

Public catalog search alone is NOT a successful MVP.

The critical workflow is:

```text
Authenticated BHX Account
          |
          v
Selected Delivery Address
          |
          v
Effective Fulfillment Store / Zone
          |
          v
Localized Product Catalog
          |
          v
Actual Price + Availability
          |
          v
Authenticated Shopping Cart
          |
          v
Verified Cart Synchronization
          |
          v
User Manually Checks Out
```

If authenticated address-specific pricing and availability cannot be verified, the integration must be considered incomplete.

---

# 2. Project Scope

## 2.1 Repository: bhx-mcp

This repository is responsible exclusively for interacting with BHX.

### Required capabilities

**Authentication**
- Interactive login.
- Persistent authenticated session.
- Session validation.
- Session expiration detection.
- Manual reauthentication.

**Delivery context**
- Retrieve saved addresses.
- Select active delivery address.
- Resolve effective fulfillment context.
- Detect delivery-context changes.

**Product catalog**
- Search products.
- Retrieve product details.
- Retrieve actual package sizes.
- Retrieve localized prices.
- Retrieve promotions.
- Retrieve availability.
- Retrieve maximum purchasable quantity when observable.

**Shopping cart**
- Read current cart.
- Add products.
- Update quantities.
- Remove products.
- Retrieve cart summary.
- Verify changes persist.

**Infrastructure**
- MCP server.
- Docker deployment.
- Persistent session storage.
- Logging and error handling.
- Hermes integration.

## 2.2 Explicitly out of scope

Do NOT implement:

- Meal planning.
- Recipe generation.
- Nutrition calculations.
- Macro or micronutrient optimization.
- Grocery basket optimization.
- Food shelf-life scheduling.
- Pantry inventory.
- Weekly dietary planning.
- Automatic checkout.
- Payment processing.

These responsibilities belong to a separate repository:

**`grocery-planner`**

That project will initially be an Agent Skill with deterministic calculation and optimization scripts.

It will consume product information through `bhx-mcp`.

The BHX integration must remain independent of dietary preferences, meal plans, and grocery budgets.

---

# 3. Research and Existing Implementation

Investigate the existing third-party project:

**Repository:** `hoangvu12/bachhoaxanh-skill`

https://github.com/hoangvu12/bachhoaxanh-skill

The repository describes:

- Product category retrieval.
- Product search.
- Product details.
- Cookie-based authentication.
- Authentication verification.
- Location information.
- Optional store, province, and ward parameters.

It also documents an internal BHX API gateway:

```text
https://api.bachhoaxanh.com/gw
```

And endpoints including:

```text
/Menu/GetMenuV2
/Category/AjaxProduct
/search/v2/DataSearch
/Product/GetListProductByIdsNew
```

**Important:** Treat these as research leads, not guaranteed working APIs.

The existing repository does NOT establish that:

- Account-specific stock can be retrieved.
- The correct fulfillment store can be resolved.
- Cart mutations are supported.
- Cart changes persist across sessions.
- Internal APIs are stable.

Audit the repository, dependencies, licensing, and current BHX behavior before reusing code.

Do not invent API endpoints, payloads, authentication mechanisms, or successful test results.

Respect applicable site terms and technical restrictions. Do not bypass CAPTCHA, rate limits, or anti-bot protections.

---

# 4. Implementation Strategy

Use a hybrid architecture:

**Playwright for authentication and browser interaction.**

**Verified BHX APIs for efficient catalog retrieval.**

**Playwright or verified APIs for shopping cart operations.**

Do not assume API access is preferable in every case.

If the website provides a reliable cart workflow but no verified cart API, use browser automation.

All operations must use the same authenticated delivery context.

## 4.1 Technology stack

Preferred:

```text
Language:       TypeScript
Runtime:        Node.js LTS
MCP:            Official TypeScript MCP SDK
Browser:        Playwright
Database:       SQLite
Deployment:     Docker Compose
Platform:       Linux
Client:         Hermes
```

Use supported, version-pinned dependencies.

Avoid unnecessary microservices.

---

# 5. Phase 0 — Research and Proof of Feasibility

**This phase is mandatory. Do not begin full MCP implementation before verifying the core integration.**

## 5.1 Authentication research

Launch a headed Playwright browser with a persistent profile.

Allow the user to log in interactively.

Requirements:

- User enters credentials directly into BHX.
- User handles OTP or CAPTCHA manually.
- Never request passwords or OTP codes through agent chat.
- Never expose session cookies to the LLM.
- Persist the authenticated browser profile securely.

Verify:

1. Login succeeds.
2. Account identity can be detected.
3. Authentication survives browser restart.
4. Authentication survives MCP restart.
5. Expired sessions can be detected.
6. Reauthentication is possible.

Document the observed authentication mechanism.

Do not assume that cookies alone are sufficient.

## 5.2 Delivery address research

After authentication:

1. Retrieve saved delivery addresses.
2. Identify the currently selected address.
3. Allow the user to select another saved address.
4. Observe network requests triggered by address selection.
5. Identify delivery-context identifiers.

Investigate whether BHX exposes:

```text
address_id
province_id
district_id
ward_id
store_id
delivery_zone_id
fulfillment_center_id
```

These are candidate concepts, not assumed API fields.

The actual API schema must be established through observation.

### Critical distinction

The geographically nearest BHX store may NOT be the store fulfilling an online order.

The MCP must prioritize the **effective fulfillment context assigned by BHX**.

If the actual store cannot be identified, expose an opaque delivery context identifier instead.

Never fabricate a store ID.

## 5.3 Localized catalog research

For the authenticated delivery address, investigate:

- Product search.
- Product details.
- Product variants.
- Package sizes.
- Prices.
- Promotions.
- Availability.
- Quantity limits.

Compare API results against the logged-in website.

Use at least 3–5 representative products during initial research.

Examples:

```text
Ức gà
Thịt heo
Cá hồi
Cải ngọt
Sữa tươi
```

Check whether prices or availability depend on:

- Delivery address.
- Store.
- Delivery zone.
- User account.
- Promotion eligibility.

If another user-authorized saved address exists, compare results between addresses.

Do not create or use an arbitrary third-party address.

## 5.4 Stock semantics

Determine what BHX actually exposes.

Possible results:

```text
Exact inventory count
Maximum order quantity
Available / unavailable
Unknown
```

Do not interpret a product appearing in search results as proof that it is purchasable.

If exact inventory is unavailable, return:

```json
{
  "availability": {
    "status": "available",
    "max_order_quantity": null,
    "inventory_count": null
  }
}
```

Unknown values must remain unknown.

Never invent numeric stock.

## 5.5 Cart research

Investigate:

1. How the current cart is retrieved.
2. How products are added.
3. How quantities are updated.
4. How products are removed.
5. Whether cart operations require authentication.
6. Whether the cart is stored server-side.
7. Whether changes persist after page reload.
8. Whether changes appear in the mobile app.
9. Whether changing delivery address changes cart contents.

Use only the user's authorized account.

Do not submit orders.

## 5.6 Research deliverable

Create:

```text
docs/feasibility.md
```

Include:

| Capability | Status | Evidence |
|---|---|---|
| Authenticated login | Verified / Unsupported | |
| Persistent session | Verified / Unsupported | |
| Saved addresses | Verified / Unsupported | |
| Delivery context | Verified / Partial / Unsupported | |
| Localized pricing | Verified / Unsupported | |
| Localized availability | Verified / Unsupported | |
| Cart read | Verified / Unsupported | |
| Cart add | Verified / Unsupported | |
| Cart update | Verified / Unsupported | |
| Cart persistence | Verified / Unsupported | |

Include sanitized request/response observations.

Remove cookies, tokens, full addresses, and personal information from logs.

### Gate A

Authenticated address-bound catalog, pricing, and availability must be verified before implementing the production cart adapter.

### Gate B

Cart read/write/persistence must be verified before claiming the full MCP is functional.

If Gate B fails, a read-only MCP may be delivered, but must be explicitly classified as incomplete.

---

# 6. Phase 1 — MCP Server Implementation

Implement the MCP server after Phase 0 establishes feasibility.

## 6.1 Authentication tools

### `bhx_auth_status`

Returns authentication state.

Example:

```json
{
  "authenticated": true,
  "account": {
    "display_name": "Masked User"
  },
  "session_status": "valid",
  "requires_login": false
}
```

Never expose access tokens or cookies.

### `bhx_login_start`

Initiates interactive login.

Returns instructions for accessing the local login browser.

Do not return credentials or session secrets.

## 6.2 Delivery tools

### `bhx_list_addresses`

Returns saved delivery addresses.

Example:

```json
{
  "addresses": [
    {
      "id": "opaque-address-id",
      "label": "Home",
      "is_default": true
    }
  ]
}
```

Redact detailed address information by default.

### `bhx_select_address`

Input:

```json
{
  "address_id": "opaque-address-id"
}
```

Behavior:

1. Select address.
2. Verify selected address.
3. Resolve effective delivery context.
4. Invalidate stale catalog and availability caches.
5. Return updated context.

### `bhx_get_delivery_context`

Example:

```json
{
  "address_id": "opaque-address-id",
  "delivery_context_id": "opaque-context-id",
  "store_id": null,
  "zone_id": null,
  "verified": true,
  "source": "authenticated-browser"
}
```

Only return store or zone identifiers when actually observed.

## 6.3 Product tools

### `bhx_search_products`

Inputs:

```json
{
  "query": "ức gà",
  "page": 1
}
```

Returns products available within the active delivery context.

### `bhx_get_product`

Input:

```json
{
  "product_id": "opaque-product-id"
}
```

Returns:

- Product identity.
- Product name.
- Product variant.
- Package size.
- Price.
- Promotion.
- Availability.
- Observation timestamp.
- Delivery context.

### `bhx_check_availability`

Input:

```json
{
  "items": [
    {
      "product_id": "opaque-product-id",
      "quantity": 2
    }
  ]
}
```

Returns availability for requested quantities.

Distinguish:

```text
available
unavailable
unknown
```

Do not fabricate inventory counts.

## 6.4 Cart tools

### `bhx_get_cart`

Retrieve the authenticated cart.

### `bhx_add_to_cart`

Add a product and verify the resulting cart.

### `bhx_update_cart_item`

Set the quantity of an existing cart item.

### `bhx_remove_cart_item`

Remove an item.

### `bhx_cart_summary`

Return:

- Cart items.
- Quantities.
- Current prices.
- Subtotal.
- Discounts.
- Delivery fees, if available.
- Total, if available.
- Unavailable items.
- Delivery context.
- Verification timestamp.

### Cart safety requirements

Cart modifications require explicit user authorization.

For bulk cart modifications:

1. Retrieve existing cart.
2. Calculate proposed changes.
3. Display the cart diff.
4. Request user confirmation.
5. Apply modifications.
6. Read cart again.
7. Verify the final state.

Do not silently remove existing items.

Do not automatically substitute products without authorization.

Do not implement checkout or payment tools.

---

# 7. Normalized Product Schema

The MCP must return normalized product information.

Do not expose raw BHX-specific API structures as the primary contract.

Example:

```json
{
  "provider": "bhx",
  "product_id": "opaque-product-id",
  "variant_id": null,
  "name": "Ức gà phi lê",
  "category": "meat",
  "pack": {
    "quantity": 500,
    "unit": "g",
    "is_fixed": true,
    "is_approximate": false
  },
  "price": {
    "amount_vnd": 45000,
    "list_amount_vnd": 50000,
    "promotion": null
  },
  "availability": {
    "status": "available",
    "max_order_quantity": null,
    "inventory_count": null
  },
  "delivery_context_id": "opaque-context-id",
  "observed_at": "2026-10-28T12:00:00+07:00",
  "source": "authenticated-api",
  "verification": "ui-matched"
}
```

## 7.1 Package requirements

Support:

- Fixed-weight packages.
- Variable-weight products.
- Individual items.
- Multipacks.
- Different units.
- Product variants.

Examples:

```text
Chicken breast — 500g fixed package
Pork — approximately 300–500g
Eggs — 10 pieces
Milk — 1 liter
Yogurt — 4 × 100g
```

Do not assume every product is sold by exact weight.

## 7.2 Price requirements

Prices must be associated with:

- Delivery context.
- Observation timestamp.
- Promotion state.
- Product variant.

Distinguish catalog price from verified cart price.

A catalog price is not a checkout guarantee.

## 7.3 Availability requirements

Use:

```typescript
type AvailabilityStatus =
  | "available"
  | "unavailable"
  | "unknown";
```

`null` means unknown, not zero.

---

# 8. Architecture

```text
                  Hermes
                    |
                    | MCP
                    v
              +-------------+
              |   BHX MCP   |
              |   Server    |
              +-------------+
                    |
       +------------+-------------+
       |            |             |
       v            v             v
   Session       Delivery       Catalog
   Manager       Context        Adapter
       |            |             |
       v            v             v
   Playwright    Address/       Verified
   Persistent    Store/Zone     BHX APIs
   Profile       Resolution
       |
       v
   Cart Adapter
       |
       +---- Verified API
       |
       +---- Playwright fallback
       |
       v
   Authenticated BHX Cart
```

## 8.1 Components

### Session Manager

Responsibilities:

- Interactive login.
- Persistent browser profile.
- Authentication validation.
- Session expiration detection.
- Reauthentication.

### Delivery Context Resolver

Responsibilities:

- Saved addresses.
- Active address.
- Store/zone resolution.
- Context verification.
- Cache invalidation.

### Catalog Adapter

Responsibilities:

- Search.
- Product details.
- Localized prices.
- Promotions.
- Availability.
- Pagination.

### Cart Adapter

Responsibilities:

- Cart reads.
- Cart modifications.
- Quantity updates.
- Persistence verification.
- Error recovery.

### Storage

Use SQLite for:

- Nonsecret catalog cache.
- Delivery-context metadata.
- Cart operation state.
- Idempotency tracking.

Keep authentication secrets and browser profiles in restricted persistent storage.

---

# 9. Repository Structure

Recommended:

```text
bhx-mcp/
├── src/
│   ├── server/
│   │   ├── index.ts
│   │   └── tools.ts
│   │
│   ├── auth/
│   │   ├── session-manager.ts
│   │   └── browser-login.ts
│   │
│   ├── delivery/
│   │   ├── address-manager.ts
│   │   └── context-resolver.ts
│   │
│   ├── catalog/
│   │   ├── search.ts
│   │   ├── products.ts
│   │   └── availability.ts
│   │
│   ├── cart/
│   │   ├── cart-manager.ts
│   │   └── cart-verifier.ts
│   │
│   ├── models/
│   │   ├── product.ts
│   │   ├── delivery.ts
│   │   └── cart.ts
│   │
│   └── utils/
│
├── scripts/
│   ├── login.ts
│   └── smoke-test.ts
│
├── tests/
│   ├── unit/
│   └── integration/
│
├── docs/
│   ├── feasibility.md
│   ├── api-observations.md
│   ├── security.md
│   └── operations.md
│
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

Structure may be adjusted based on implementation needs.

Avoid overengineering.

---

# 10. Deployment

Deploy on a self-hosted Linux machine using Docker Compose.

## 10.1 Requirements

- Persistent browser profile.
- Persistent application data.
- Automatic container restart.
- Health checks.
- Structured logging.
- Environment-based configuration.
- Reproducible deployment.

## 10.2 Security

Never expose:

- Passwords.
- OTP codes.
- Session cookies.
- Access tokens.
- Complete delivery addresses.
- Browser debugging endpoints.

Do not commit:

```text
.env
cookies
browser profiles
session data
HAR captures
database files
logs
```

Use restrictive filesystem permissions.

Prefer localhost or private-network access.

If remote MCP access is required:

- Require authentication.
- Use TLS.
- Prefer VPN or a secured reverse proxy.
- Do not expose an unauthenticated MCP endpoint publicly.

Do not attempt CAPTCHA bypass or anti-bot evasion.

## 10.3 Browser login

The user must be able to perform interactive login.

Possible approaches:

- Local headed Playwright browser.
- Secured VNC/noVNC browser session.
- Other supported interactive browser mechanism.

Choose the simplest approach compatible with the deployment environment.

Document the exact login and reauthentication procedure.

---

# 11. Hermes Integration

Register `bhx-mcp` with the installed Hermes environment.

First inspect:

- Hermes version.
- Supported MCP transports.
- MCP configuration format.
- Existing MCP servers.
- Available runtime permissions.

Do not invent Hermes configuration syntax.

Use the actual installed version and supported configuration.

Supported deployment options may include:

```text
Local stdio MCP
```

or:

```text
Authenticated HTTP MCP over private network
```

Prefer the simplest option that works reliably.

Document exact commands in `README.md`.

---

# 12. Error Handling

Implement explicit errors.

Examples:

```text
AUTH_REQUIRED
SESSION_EXPIRED
ADDRESS_NOT_SELECTED
DELIVERY_CONTEXT_UNKNOWN
PRODUCT_NOT_FOUND
PRODUCT_UNAVAILABLE
PRICE_CHANGED
QUANTITY_LIMIT_EXCEEDED
CART_VERIFICATION_FAILED
RATE_LIMITED
NETWORK_ERROR
```

Errors must be actionable.

Examples:

**SESSION_EXPIRED**

> The BHX session has expired. Interactive login is required.

**PRICE_CHANGED**

> Product price changed from 45,000 VND to 49,000 VND. Cart update was not applied.

**CART_VERIFICATION_FAILED**

> The cart modification was attempted but could not be verified. Refresh the cart before retrying.

Avoid blind retries of non-idempotent cart operations.

Implement bounded retries and exponential backoff where appropriate.

---

# 13. Verification and Acceptance Tests

## 13.1 Authentication

Verify:

- Login succeeds.
- Session persists across restart.
- Expiration is detected.
- Reauthentication works.
- Secrets are never exposed.

## 13.2 Delivery context

Verify:

- Saved addresses can be retrieved.
- Active address can be selected.
- Selection persists or is restored correctly.
- Context changes invalidate cached prices and availability.
- All catalog and cart operations use the selected context.

## 13.3 Catalog

Test at least 10 varied products.

Compare against the authenticated BHX website:

- Product name.
- Package size.
- Price.
- Promotion.
- Availability.

Record timestamped, sanitized evidence.

If another authorized saved address exists, repeat selected tests after changing address.

## 13.4 Cart

Verify:

1. Read existing cart.
2. Add one product.
3. Read cart again.
4. Verify product and quantity.
5. Reload browser.
6. Verify persistence.
7. Update quantity.
8. Verify updated quantity.
9. Remove product.
10. Verify removal.

Check mobile-app synchronization if possible.

Never submit an order.

## 13.5 Failure cases

Test:

- Expired session.
- Network timeout.
- Product unavailable.
- Quantity limit.
- Price change.
- Address change.
- Duplicate cart request.
- Partial cart update.
- Server restart.

## 13.6 Deployment

Verify:

- Docker Compose starts successfully.
- Health check passes.
- Session persistence works.
- Hermes can discover MCP tools.
- Hermes can retrieve authenticated products.
- Hermes can read the current cart.
- User-approved cart modification works.

---

# 14. Future Integration: grocery-planner

The future repository:

```text
grocery-planner
```

Will implement:

```text
Agent Skill
    |
    +-- Dietary profile
    +-- Nutrition guidelines
    +-- Food composition data
    +-- Meal planning rules
    +-- Shelf-life scheduling
    +-- Deterministic optimizer
    |
    v
bhx-mcp
    |
    +-- Localized products
    +-- Package sizes
    +-- Prices
    +-- Availability
    +-- Shopping cart
```

The future workflow:

```text
User requests weekly meal plan
          |
          v
Load dietary preferences
          |
          v
Query BHX products
          |
          v
Generate candidate meals
          |
          v
Calculate nutrition
          |
          v
Optimize package quantities
          |
          v
Check budget and shelf life
          |
          v
Generate proposed cart
          |
          v
User approves cart changes
          |
          v
BHX MCP updates cart
          |
          v
User manually checks out
```

The `grocery-planner` project must not depend directly on BHX's internal API schema.

It should consume the normalized MCP product contract.

**Do not implement this project as part of the current task.**

---

# 15. Execution Instructions for Hermes

Execute the following sequence.

### Step 1 — Environment inspection

Inspect:

- Operating system.
- Docker installation.
- Node.js environment.
- Hermes installation and version.
- Existing MCP configuration.

Create the `bhx-mcp` project.

### Step 2 — Research

Inspect the existing BHX skill repository.

Investigate the actual BHX website and API behavior.

Document findings.

### Step 3 — Authentication POC

Implement interactive Playwright login.

Request user interaction only when the browser is ready.

Verify persistent authentication.

### Step 4 — Delivery-context POC

Retrieve saved addresses.

Identify the effective delivery context.

Verify localized product search and pricing.

### Step 5 — Cart POC

Investigate cart operations.

Verify authenticated cart persistence.

### Step 6 — Feasibility report

Produce:

```text
docs/feasibility.md
```

Classify each capability:

```text
Verified
Partially verified
Unsupported
```

Include reproducible evidence and blockers.

### Step 7 — MCP implementation

Implement verified capabilities.

Do not fabricate unsupported functionality.

### Step 8 — Deployment

Build and deploy using Docker Compose.

Register MCP with Hermes.

### Step 9 — End-to-end testing

Run real authenticated smoke tests.

Verify address-bound pricing and cart synchronization.

### Step 10 — Final report

Report:

- Implemented features.
- Verified features.
- Unsupported features.
- Deployment location.
- Container status.
- MCP connection status.
- Login status.
- Selected delivery context (masked).
- Catalog test results.
- Cart test results.
- Known limitations.
- Exact startup and maintenance commands.

Do not claim completion without successful end-to-end verification.

---

# 16. Definition of Done

The project is considered complete only when:

- [ ] MCP server is deployed and running.
- [ ] Hermes can connect to the MCP server.
- [ ] User can log in to BHX interactively.
- [ ] Authentication persists across restarts when the session remains valid.
- [ ] Saved delivery addresses can be retrieved.
- [ ] The active delivery address can be selected and verified.
- [ ] Effective delivery context is established without fabricated store IDs.
- [ ] Product search uses the selected delivery context.
- [ ] Localized prices match the authenticated BHX website.
- [ ] Availability matches observable BHX behavior.
- [ ] Package sizes and variants are represented accurately.
- [ ] Existing cart can be retrieved.
- [ ] Products can be added to the cart.
- [ ] Product quantities can be updated.
- [ ] Products can be removed.
- [ ] Cart changes persist after reload.
- [ ] Cart changes are verified after each operation.
- [ ] Existing cart contents are protected from unapproved changes.
- [ ] No checkout or payment functionality exists.
- [ ] Secrets are protected.
- [ ] README and operational documentation are complete.

If a critical requirement cannot be verified, deliver a partial implementation with a documented blocker.

**Never substitute mock data for real integration results.**

---

# 17. References

**BHX official website:**
https://www.bachhoaxanh.com/

**Existing third-party implementation:**
https://github.com/hoangvu12/bachhoaxanh-skill

**Model Context Protocol:**
https://modelcontextprotocol.io/

**Playwright:**
https://playwright.dev/

**Agent Skills:**
https://agentskills.io/

---

# 18. Final Instructions

Prioritize working authenticated integration over architectural complexity.

The highest-priority proof is:

```text
REAL ACCOUNT
    +
REAL DELIVERY ADDRESS
    +
REAL LOCALIZED PRICES
    +
REAL AVAILABILITY
    +
REAL SYNCHRONIZED CART
```

Do not spend time implementing meal planning or optimization.

Do not assume an endpoint works merely because it exists in a third-party repository.

Do not bypass authentication protections.

Do not initiate checkout.

**Start with Phase 0. Verify the real BHX behavior before implementing the complete MCP server.**
