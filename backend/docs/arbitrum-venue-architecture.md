# Arbitrum-first venue architecture

## What changed

Arbitrum `42161` is the only active EVM strategy chain. Particle and Magic are interchangeable owner signers. The user's Universal Account (UA) is the strategy owner; Moeazi never creates or stores a fallback owner key. Venue accounts are protocol linkages and restricted delegates under that owner.

Optimism is legacy-read-only. It can remain visible in Particle's unified balance and can be the source of a user-confirmed migration, but it is not used by new strategies or active Uniswap routing.

## Simplified system

```mermaid
flowchart LR
  P["Particle signer"] --> O["OwnerSigner"]
  M["Magic signer"] --> O
  O --> UA["User UA on Arbitrum"]
  UA --> V["Restricted venue authorities"]
  V --> H["Hyperliquid"]
  V --> L["Lighter"]
  V --> R["Orderly"]
  V --> G["GMX"]
  V --> S["Ostium"]
  V --> U["Uniswap"]
```

Why: the user has one ownership boundary while each venue receives only the permission it needs. A compromised venue delegate cannot become the user's owner key.

## Full control and data plane

```mermaid
flowchart TB
  UI["Portal and trading terminal"] --> C["Convex product state"]
  UI --> OS["Particle or Magic OwnerSigner"]
  C --> API["Python API"]
  API --> T["Temporal workflows"]
  T --> W["Agent workers"]
  W --> PG["Postgres / Timescale evidence"]
  W --> R["Redis hot state and limits"]
  T --> X["Execution gateway"]
  X --> PF["Deterministic policy preflight"]
  PF --> Q["Fresh venue quote"]
  Q --> SIM["Mainnet simulation"]
  SIM --> K["KMS credential unwrap in memory"]
  K --> PY["Python venue adapters"]
  K --> TS["TypeScript GMX / Uniswap sidecar"]
  OS -->|"Approval signature or scoped delegation"| X
  PY --> VEN["Mainnet venues"]
  TS --> VEN
  VEN --> REC["Receipt and position reconciliation"]
  REC --> C
```

Why: Convex remains the user-facing source of truth, Temporal owns long waits and retries, and execution is isolated from LLM workers. No agent receives credentials or signing tools.

## Owner signer

```mermaid
flowchart LR
  AUTH["Signed-in session"] --> DET["Detect provider and 7702 capability"]
  DET -->|"Magic"| MS["Magic authorization methods"]
  DET -->|"Particle"| PS["Wallet client / UA root signature"]
  MS --> UA["Same UA transaction contract"]
  PS --> UA
  UA --> CAP["Shadow yes · Approval yes · Autopilot only if delegated"]
```

Why: product code uses one contract instead of branching on provider throughout the application. Unsupported Particle wallets fail down to Shadow or Approval and never silently gain Autopilot authority.

Improve next: add wallet-specific contract fixtures for session expiry and authorization replacement, then support audited permission modules when the selected UA implementation exposes them.

## Venue setup workflow

```mermaid
stateDiagram-v2
  [*] --> Created
  Created --> AwaitingDelegation
  AwaitingDelegation --> AwaitingFunding
  AwaitingFunding --> AwaitingSignature
  AwaitingSignature --> Verifying
  Verifying --> Ready
  Verifying --> Failed
  Ready --> Revoked
```

Convex stores material state. Temporal waits for user signatures without polling Convex. The gateway generates credentials, keeps encrypted envelopes behind KMS, and signals verification only after mainnet collateral and authority checks pass. Routing cannot be enabled before `Ready`.

Why: setup and order submission have separate environment gates. Setup does not spend agent credits or call an LLM.

Improve next: implement each protocol verifier and transaction builder against recorded mainnet responses, then certify tightly capped funded canaries. Until then, attempts remain `Verifying` and live routing stays off.

## Uniswap on Arbitrum

```mermaid
flowchart LR
  A["Verify token registry"] --> B["check_approval"]
  B --> C["User-approved allowance if needed"]
  C --> D["quote · string chain IDs"]
  D --> E{"Route"}
  E -->|"CLASSIC"| F["Signature + permitData together, or neither"]
  E -->|"UniswapX"| G["Local signature; omit permitData from swap request"]
  F --> H["swap"]
  G --> H
  H --> I["Validate sender, target, calldata, value, chain, freshness"]
  I --> J["eth_call simulation"]
  J --> K["Policy and environment gates"]
  K --> L["UA submission and receipt reconciliation"]
```

The active registry contains native Arbitrum USDC and WETH. LINK is versioned and must match deployed bytecode, symbol, decimals, and chain at runtime. Quotes older than 30 seconds are rejected. WETH is never fully unwrapped automatically.

Why: Trading API routing can select V2, V3, V4, or UniswapX without hardcoded pool assumptions, while target allowlists keep returned calldata bounded.

Improve next: maintain the UniswapX reactor allowlist from audited deployment metadata, persist receipt reconciliation, and add an audited bundler-based scoped delegation before smart-account Autopilot is certified.

## Legacy Optimism migration

```mermaid
flowchart LR
  R["Read balances, pending txs, allowances"] --> P["Preview revocations and retained gas"]
  P --> U["User confirms each action"]
  U --> T["Transfer to UA"]
  T --> A["Particle sources assets on Arbitrum"]
  A --> V["Verify Arbitrum balances"]
  V --> Z["Archive legacy linkage"]
```

No bridge, transfer, allowance revocation, or archive occurs automatically. A migration stays open until both sides reconcile.

## Safety gates

Runtime authority is the minimum of deployment ceiling, user mode, active policy, credit state, venue health, reconciliation health, and credential status. Development continues to default to Manual Guard ON, Lite Mode ON, `MAINNET_VENUE_SETUP_ENABLED=false`, and `LIVE_EXECUTION_ENABLED=false`.

The architecture is intentionally incomplete for live release until all six mainnet adapters have deterministic setup verification, duplicate-credential protection, receipt reconciliation, revocation tests, recorded response tests, fork simulations, and capped funded canaries.
