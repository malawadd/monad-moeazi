# Venue routing and web-app integration

This milestone is intentionally read-only. It discovers public markets, compares fresh quotes, and
simulates the selected route. It never requests an approval, signature, funding transfer, or broadcast.

## Simple view

```mermaid
flowchart LR
    UI["Terminal / Routing Lab"] --> API["Authenticated Next proxy"]
    API --> R["Python quote router"]
    R --> V["Five perp venues"]
    R --> C["Redis short cache"]
    UI --> CX["Convex account readiness"]
    R --> UI
```

Why: public market traffic does not pass through Convex, so quote refreshes produce zero Convex writes.
Convex answers only the user-specific question: which venue accounts are ready?

## Detailed view

```mermaid
flowchart TB
    T["Perp terminal"] --> P["/api/agent-backend"]
    L["Agent Lab route tester"] --> P
    S["Uniswap spot page"] --> P
    P --> M["GET /v1/routing/markets"]
    P --> Q["POST /v1/routing/preview"]
    P --> U["POST /v1/swap/quote"]
    M & Q --> RS["RoutingService"]
    RS <--> RC["Redis 10s previews / 5m markets"]
    RS --> HL["Hyperliquid l2Book"]
    RS --> LI["Lighter orderBookOrders"]
    RS --> OR["Orderly market proxy"]
    RS --> GS["GMX SDK sidecar"]
    RS --> OS["Ostium Python SDK"]
    U --> US["Uniswap Trading API sidecar"]
    S --> UH["Optional v4 hook quote comparison"]
    UH --> VQ["Arbitrum V4Quoter + local calldata"]
    T --> VI["Convex venueIntegrations"]
    VI --> Q
```

### Market catalog

Each adapter emits `MarketListing`; the service canonicalizes symbols and creates a union keyed by base
market. A partial venue outage removes only that venue. The catalog cache prevents repeated discovery.

Why: users see every reachable market without pretending that one venue is the canonical catalog.

Improve: replace symbol heuristics with a versioned instrument registry containing contract, chain,
collateral, settlement, and expiry identifiers.

### Normalized quote adapters

Hyperliquid and Lighter use real public depth. Orderly, GMX, and Ostium currently use an explicitly named
price/liquidity proxy when a public preparation endpoint does not expose a complete unsigned book. Proxy
sources stay visible in technical details and use conservative spreads.

Why: the router can fail a venue independently and never fabricates a successful executable quote.

Improve: maintain Orderly WebSocket books, call GMX `prepareOrder` with a non-signing managed address, and
replace Ostium's proxy with the protocol's exact price-impact calculation.

### Cost and selection

The route models entry and exit taker fees, entry and exit depth impact, and funding over the requested
hold time. Setup cost is separate and never hidden inside execution cost. Candidates are ordered by:

1. Rounded all-in cost (one-cent tie tolerance).
2. Freshness.
3. Stable venue priority.

`bestMarketVenue` is the cheapest public route. `bestExecutableVenue` is the cheapest account-ready route.
The terminal selects the latter and explains when a cheaper venue requires setup. A user override is
accepted only for an eligible, ready venue.

Why: a cheaper route is useless if the account cannot execute it, but hiding it prevents users from
improving their setup.

Improve: add gas quotes, bridge inventory opportunity cost, rebates, VIP fee tiers, and probability-weighted
execution/fill risk.

### Readiness control plane

`venueIntegrations` records enabled/readiness state without storing credentials. `venueAccounts` remains
the credential-bearing execution record. Enabling an integration creates only a setup requirement; it does
not generate a key or authorize a venue automatically.

Why: control-plane intent and credential custody have different lifecycles and audit requirements.

Improve: add a durable provisioning workflow that creates the minimum venue credential only after explicit
authorization, then patches readiness after a read-only account probe.

### Uniswap spot quote

The `/swap` page sends an exact-input request through the sidecar. CLASSIC and UniswapX output shapes are
parsed separately. Approval, typed-data signing, transaction validation, and simulation are implemented;
broadcast remains environment- and certification-gated.

Why: Uniswap spot routing is not comparable to leveraged perpetual venues and deserves a simpler product
surface and a separate safety boundary.

Improve: add token metadata discovery, chain selection, allowance display, price impact, route legs, and an
explicit confirmation flow only after execution certification.

The optional hook comparison does not participate in route selection. It is
available only when an exact hook address, permission-bit pattern, bytecode hash,
fee, tick spacing, and Arbitrum RPC are configured. The sidecar constructs and
attests the v4 route itself and always blocks broadcast. See
[Uniswap v4 hook experiment](uniswap-v4-hook-experiment.md).

## Safety and failure behavior

| Condition | Behavior |
|---|---|
| One venue times out | Other venues still return |
| Quote older than 60 seconds | Venue excluded |
| Insufficient depth | Venue excluded |
| Leverage/minimum violation | Venue excluded with a readable reason |
| Cheapest venue unready | Ready runner-up selected; setup requirement shown |
| Override unready | Override ignored with warning |
| Redis unavailable in development | Request fails; no fallback transaction or Convex polling |
| Live execution disabled | Terminal simulation only |

## Production exit criteria

- Replace every proxy quote with venue-exact unsigned preparation or maintained depth.
- Add fee-tier/account-specific inputs and gas estimation.
- Pass recorded contract tests plus rate-limit, timeout, malformed, and stale-data cases.
- Reuse this router inside agent proposal/execution workflows so UI and agents cannot disagree.
- Keep broadcast gated until all venue sandbox suites and funded canaries are certified.

## Feature 32 local research boundary

The Test Center’s Feature 32 evaluator is not a second router and is not connected to
`RoutingService`. It uses checked-in synthetic observations and exact integer cost
comparisons to exercise freshness, source-class, book-continuity, reconciliation,
channel and uncertainty-latch rules. Its plans are hypothetical, product routing is
unchanged, and no venue, network, signing, broadcast or funded action can occur.
