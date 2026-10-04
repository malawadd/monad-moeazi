# Autonomous Agent Backend Architecture

> Active venue ownership and chain boundaries are documented in [Arbitrum-first venue architecture](./arbitrum-venue-architecture.md). Optimism references below describe legacy migration behavior only.

## Principles

- Convex owns customer-visible state; Timescale owns detailed history.
- Temporal schedules and workflows own autonomous work. No process polls Convex.
- Shadow, Approval, and Autopilot all analyze automatically; only authority differs.
- Manual Guard and Lite Mode are development controls, not customer modes.
- Analysis workers never receive credentials or venue execution tools.
- Runtime authority is the lowest of deployment, user, policy, credits, and health ceilings.

## Entire system — simplified

```mermaid
flowchart LR
    U["Customer"] --> P["Signed-in portal"]
    P --> C["Convex product state"]
    C --> T["Temporal schedules"]
    T --> A["Specialist team"]
    A --> S["Typed synthesis + proposal"]
    S --> M{"Customer mode"}
    M -->|Shadow| X["Fresh quote + simulated fill"]
    M -->|Approval| Q["Approval inbox"]
    M -->|Autopilot| E["Deterministic execution workflow"]
    Q -->|Approve| E
    E --> V["Isolated venue gateway"]
```

The public terminal shows status and explanations. Wallets, strategies, policies, credits,
approvals, and configuration stay in the portal.

## Entire system — detailed

```mermaid
flowchart TB
    subgraph UI["Application surfaces"]
      TERM["Public terminal + agent rail"]
      PORTAL["Portal: agent, policy, approvals, activity, credits"]
      LAB["Development-only Agent Lab"]
    end
    subgraph CX["Convex control plane"]
      PROFILE["One profile / strategy account"]
      SUB["Indexed subscriptions"]
      POLICY["Versioned policies"]
      JOB["Indexed active jobs"]
      SNAP["One current snapshot / scope"]
      CREDIT["Reservations + ledger"]
      TRADE["Proposals, approvals, shadow fills"]
    end
    subgraph ORCH["Python + Temporal"]
      SCHEDULE["Schedule / watched market"]
      EVENT["Redis event stream"]
      FLOW["Analysis workflow"]
      ROUTE["Tier/provider router"]
      EXEC["Execution workflow"]
    end
    subgraph DATA["Evidence plane"]
      FEEDS["Venue, chain, news, social"]
      REDIS["Hot state, controls, caps, dedupe"]
      PG["Timescale history"]
    end
    subgraph MODEL["Model providers"]
      OPENAI["OpenAI"]
      DEEP["DeepSeek"]
      OPENROUTER["OpenRouter BYOK<br/>upstream-aware routing"]
    end
    subgraph GATE["Execution boundary"]
      PY["Python venue adapters"]
      TS["GMX + Uniswap sidecar"]
      KMS["KMS envelope unwrap"]
      VENUES["Six venue APIs"]
    end

    TERM --> SNAP & TRADE
    PORTAL --> PROFILE & SUB & POLICY & CREDIT & TRADE
    LAB --> REDIS
    PROFILE --> SCHEDULE --> FLOW
    EVENT --> FLOW
    REDIS & PG --> FLOW
    FLOW --> ROUTE --> OPENAI & DEEP & OPENROUTER
    ROUTE --> PG & SNAP & TRADE
    TRADE --> EXEC
    EXEC --> POLICY & CREDIT
    EXEC --> PY & TS
    PY & TS --> KMS --> VENUES
    FEEDS --> REDIS & PG
```

## 1. Modes and runtime authority

```mermaid
stateDiagram-v2
    [*] --> Shadow
    Shadow --> SimulatedFill: proposal + fresh quote
    [*] --> Approval
    Approval --> Waiting: proposal
    Waiting --> Requote: user approves
    [*] --> Autopilot
    Autopilot --> Requote: proposal
    Requote --> Blocked: any check fails
    Requote --> SimulatedExecution: development gates closed
    Requote --> SignedSubmission: live + all venues certified
```

Why: analysis stays consistent while authority remains explicit and auditable. Legacy `insights`
normalizes to Shadow. Every real submission checks deployment, policy, credits, evidence, quorum,
venue health, quote freshness, balance/exposure/loss, emergency stop, reconciliation, and idempotency.

Improve next: persist a customer-readable authority-decision object for every proposal.

## 2. Development safeguards

```mermaid
flowchart LR
    LAB["Agent Lab switch"] --> RC["Redis RuntimeControls"]
    RC --> MG{"Manual Guard?"}
    MG -->|On| PAUSE["Pause schedules + cancel queued automatic jobs"]
    MG -->|Off| LM{"Lite Mode?"}
    LM -->|On| CLAMP["1 market, 2 calls, 250 tokens, no retry"]
    CLAMP --> CAP["4/account + 8/global + $0.10/day"]
    LM -->|Off| FULL["Configured customer tier"]
```

Why: missing Redis state resolves to both safeguards on. Disabling either requires typed cost
confirmation. Manual runs remain possible. One atomic Redis script protects concurrent daily caps.

Improve next: reconcile provider-returned usage against the pre-dispatch maximum reservation.

## 3. Scheduling and dispatch

```mermaid
sequenceDiagram
    participant UI as Portal
    participant CX as Convex
    participant API as Agent API
    participant TS as Temporal Schedule
    participant WF as Analysis Workflow

    UI->>CX: Save profile + indexed subscriptions
    UI->>CX: Activate
    UI->>API: Authenticated schedule sync
    API->>TS: Upsert schedule per market
    TS->>WF: Cadence tick
    WF->>CX: Validate profile revision + enqueue idempotently
    WF->>CX: Reserve credits
    WF->>WF: Analyze, synthesize, route
    WF->>CX: Patch snapshot + settle credits
```

Why: idle workers make zero Convex calls. Revisions invalidate stale ticks, status indexes avoid
historical scans, and account/market indexes prevent overlap.

Improve next: complete the Redis material-event consumer and a transactional schedule-sync outbox.

## 4. Agent analysis and evidence

```mermaid
flowchart LR
    E["Bounded sanitized evidence"] --> R{"Tier router"}
    R -->|Focus| F["6 roles + synthesis"]
    R -->|Pro| P["12 roles, 4 dual + critic + synthesis"]
    R -->|Max| M["20 roles, 10 dual + 2 syntheses + arbiter"]
    R -->|Lite| L["Technical + liquidity"]
    F & P & M --> Q["Typed validation + quorum"]
    L --> D["Deterministic synthesis"]
    Q & D --> O["Human snapshot + typed proposal"]
```

Why: external text is evidence, never instructions. Provenance and hashes remain attached. Compact
inputs stop recursive token growth. Provider details are stored for audit but hidden from customer UI.

Improve next: outcome-calibrate roles and omit roles whose source freshness misses its objective.

## 5. Credits and current-state storage

```mermaid
stateDiagram-v2
    [*] --> Estimated
    Estimated --> Reserved: before dispatch
    Reserved --> Settled: validated outputs
    Reserved --> Released: unused / failed / malformed
```

Convex patches one current public market snapshot and one private account/market snapshot. Timescale
retains evidence, calls, syntheses, and evaluations. Integer credits plus a versioned rate card preserve
billing history before checkout exists.

Improve next: add per-role cost/value attribution and automatic Convex IO budgets.

## 6. Execution and custody

```mermaid
flowchart LR
    P["Approved proposal"] --> Q["Fresh quote"]
    Q --> C["Independent checks"]
    C --> I["Idempotency + circuit breakers"]
    I --> D{"Live + certified?"}
    D -->|No| SIM["Dry-run execution"]
    D -->|Yes| K["KMS unwrap in memory"]
    K --> S["Sign + submit"]
    S --> R["Confirm + reconcile"]
```

Why: analysis cannot sign. Raw credentials exist only inside the gateway and are zeroed after use.
A broadcast Uniswap transaction is reconciled, never described as cancellable.

Improve next: finish private signing adapters and move signing into short-lived hardware-backed workers.
Production remains blocked until all six sandbox suites and funded canaries pass.

## Failure model

| Failure | Safe behavior |
|---|---|
| Redis state missing | Manual Guard ON and Lite Mode ON |
| Duplicate tick/approval | Active index + idempotency returns existing work |
| Worker/API restart | Temporal resumes |
| Provider invalid/timeout | No user billing; Lite never retries |
| Credits exhausted | Dispatch/execution blocks |
| Stale evidence or lost quorum | Autopilot blocks |
| Emergency stop race | Fresh preflight wins before signing |
| Venue degraded/drift | Circuit breaker blocks |
| Live/certification gate closed | State machine records a simulation |
