# Wallets, Venues, and Execution

Mobile modular funding and covered network fees are implemented behind closed rollout
gates. Read [mobile integrations](../mobile-modular-integrations.md) before enabling
anything. Provider secrets stay in execution-sidecar; Next/mobile consume normalized
interfaces. New sponsored v2 operations are separate from legacy direct withdrawals.
Kernel 0.3.3/EntryPoint v0.7 require verified code hashes and provider/native
certification. No funded checkout/sponsorship canary has been performed.

Feature 21 cannot grant execution authority and has no wallet, signer, gateway, sidecar, venue, RPC, or on-chain path.

The local instrument lifecycle registry is not an execution adapter. Its fixture
decisions cannot supply a market identifier to a signer, gateway, or sidecar.

## Ownership model

Arbitrum One (`42161`) is the only active EVM strategy execution chain. Particle and
Magic are normalized behind `OwnerSigner`. The signed-in owner and Universal Account
(UA) are the ownership root; Moeazi must not generate or store a fallback owner key.

The account record keeps owner address, UA/deposit addresses, provider, account mode,
EIP-7702 delegation state, delegated chains, implementation/capabilities, and unified
balance metadata. A strategy links to this `accountWallet`.

Particle and Magic behavior must converge on the same capabilities:

- Shadow is always available.
- Approval is always available and requests a fresh user signature.
- Autopilot requires supported EIP-7702 plus active Arbitrum delegation.

Wallets without that capability stay usable in Shadow/Approval. Never fake Autopilot
by creating another funded owner wallet.

## Venue accounts are not separate Moeazi owners

The six strategy venues are Hyperliquid, Lighter, Orderly, GMX, Ostium, and Uniswap.
Protocol-specific account IDs, API keys, delegates, subaccounts, or one-click
permissions are restricted linkages beneath the user owner:

- `venueIntegrations`: customer intent, routing enablement, readiness, authority mode.
- `venueAccounts`: protocol account/linkage, delegate public data, collateral/readiness.
- `venueCredentials`: encrypted restricted credential envelope.
- `venuePermissions`: scoped authority, limits, expiry, transaction reference.
- `venueSetupAttempts`: durable setup state and user-signature checkpoints.

The user may need protocol collateral deposits, but does not create six independent
Moeazi owner wallets.

For the internal managed Uniswap spot prototype, the authenticated Magic address
is the USDC source and vault owner. The existing Particle Universal Account SDK
can prepare and relay an EIP-7702 operation for that same address; the funding
quote must bind its owner, sender, delegated chain, and canonical USDC capital
to that Magic address. Particle is not a second customer wallet. The restricted
Moeazi executor pays gas for vault deployment and permitted vault operations,
but never receives the customer's USDC. These transactions require a positive
`MANAGED_VAULT_MAX_TX_GAS_COST_WEI` operator cap and sufficient executor ETH;
without either, the sidecar rejects broadcast. A passing local quote or test
does not establish that the current Magic delegation accepts the live quote.

The installed Particle Universal Account SDK (`2.0.0-beta.3`, protocol `2.0.1`)
was qualified with an unsigned read-only quote for the internal Magic owner on
2 October 2026. Its quote encodes token amounts as 18-decimal hex, can select
either canonical Arbitrum USDC or native ETH for the funding fee, and does not
expose decoded calls, an inner sender, or a token sender in `userOps`.
The funding boundary therefore checks the returned owner/sender, delegated
Arbitrum operation, exact capital amount, one bounded fee, and quote expiry;
the application constructs only the exact approve-and-fund batch before asking
the SDK for a quote. The quote's opaque call encoding remains a Particle trust
boundary. The phone reviews the quoted fee before Magic signs, and finalized
vault funding is required before capital becomes active. A placeholder-address
read-only quote does not qualify a real deployed vault or a submitted operation.

## Setup workflow

The intended mainnet flow is:

1. Verify the Particle/Magic owner and UA.
2. Verify or prepare Arbitrum EIP-7702 delegation.
3. Preview funding amount, gas, protocol fees, limits, permissions, and expiry.
4. Wait for the provider-specific user signature/transaction.
5. Create the minimum restricted venue credential inside the execution boundary.
6. Register permission, verify collateral and authority, then mark routing ready.

Temporal owns long waits. Convex records material state transitions. Setup uses no
LLM calls or agent credits and must create no idle traffic.

Hyperliquid's internal mobile binding now has two narrow authenticated routes.
The Magic session and Convex ownership query must match the current verifying
setup attempt and owner wallet before Next.js forwards a challenge or credential
registration to the execution gateway. The signed challenge binds the master,
target account, API-wallet address, setup attempt, nonce and expiry. Gateway
registration checks Hyperliquid Info roles and agent expiry, encrypts the key,
and leaves routing and permission disabled. `EXECUTION_GATEWAY_PUBLIC_URL`
selects the Next.js-to-gateway address (local default `127.0.0.1:9200`). The
API-wallet key is transiently carried by this request; it must not be logged,
stored in Convex, or sent to analysis workers. No funded binding has been run.

## Direct mobile withdrawal boundary

User-directed mobile withdrawals send only canonical Arbitrum USDC from the current
Magic owner. They use a dedicated `mobileWalletWithdrawals` projection rather than
the legacy managed-venue withdrawal table. Convex owns current operation state;
Magic signs and broadcasts the exact server-prepared ERC-20 transfer on the phone;
and `MobileWithdrawalWorkflow` durably verifies the sender, calldata, receipt and
matching `Transfer` log. An uncertain send is reconciliation-only and is never
automatically rebroadcast. This boundary cannot submit trades, approvals, swaps or
EIP-7702 delegation and does not relax autonomous-execution certification gates.

`MAINNET_VENUE_SETUP_ENABLED` controls setup. `LIVE_EXECUTION_ENABLED` separately
controls submission. Do not bypass the first to test the second.

Gateway policy now binds an exact dependency-safety decision and dispatch revalidates
its operation, subject, bindings, idempotency, hash, and expiry. Owner-signer
readiness, authoritative risk, and reconciliation remain `UNKNOWN` until their
authoritative owners exist; no fallback key or model execution tool is introduced.

## Execution contract

Venue adapters share:

```text
quote, balance, positions, place, cancel, close, reconcile, health
```

Before any real submission, independently check current environment ceiling,
certification, active policy/version, balance, exposure/loss, credits, evidence age
and completeness, model quorum, venue health, quote freshness, slippage, emergency
stop, reconciliation, and idempotency.

Agent workers produce evidence and proposals only. Credentials are unwrapped only in
the gateway/sidecar process, in memory, through local wrapping in development or KMS
in production. Raw owner/provider/venue keys must never enter Convex or model prompts.

Feature 04 does not change this live boundary. Its fake vault accepts only synthetic
non-owner fixtures and classifies legacy wallet shapes as quarantine metadata.
Particle/Magic ownership and every private execution gate remain unchanged.

Feature 08 does not change it either. Its local capability grants are fixture
fingerprints only; no Test Center result can be consumed by owner signing, the gateway,
or the sidecar.

Feature 32 is likewise fixture-only. Its exact-integer route comparison may exclude
unsafe synthetic candidates but cannot select a product route, prepare a payload,
reach a venue, or change signer, wallet, gateway, sidecar, routing, or execution
readiness.

Feature 33 is also fixture-only. It cannot replace product Shadow execution, treat a
quote as a certified fill, prepare a transaction, call a venue, or affect any signer,
wallet, gateway, sidecar, router, customer mode, or execution readiness.

## Current implementation status

Public/read-only routing is active enough for development:

- Hyperliquid and Lighter use public depth.
- Orderly, GMX, and Ostium may use clearly labeled conservative proxy data where
  exact unsigned preparation/depth is incomplete.
- Redis caches market discovery and previews.
- The terminal distinguishes cheapest public route from cheapest account-ready route.

Private venue execution is gated:

- Hyperliquid public quote/balance/positions exist; exact scoped SDK
  order/cancel/perpetual-close primitives are connected to the adapter, but
  gateway health still disables native submission. A separate credential
  channel requires `GATEWAY_CREDENTIAL_SECRET` and does not accept the broad
  `/worker` secret; dispatch does not yet consume the credential client.
- Several venue adapters remain certification-blocked.
- The sidecar exposes GMX market reads and Uniswap preparation.
- Generic execute/broadcast endpoints return blocked/not-implemented until signing and
  certification are complete.

Do not describe “setup intent,” “ready-looking UI,” public quote availability, or a
simulation as a working live adapter.

## Uniswap on Arbitrum

The internal Magic-owned vault prototype is a separate authority path from the
older Kernel scoped-grant setup. The Magic address remains the owner signer;
Particle Universal Account prepares and relays its owner-signed approve/fund
batch on that same address. There is no second Particle owner wallet: if the
quote names a different owner or sender, funding is rejected. Committed USDC
then resides in a vault bound to one Magic owner and one program. Convex records the mandate, vault identity and funding
state; the sidecar verifies immutable code, owner, executor, program, policy,
capital and finalized balances. Python now has a distinct vault-source finance
observation and activation route. Only the vault's USDC/WETH balances can enter
that financial account; owner-wallet balances are excluded. The operator policy
registration entry point is `moeazi_agent.managed_vault_policy_provision`.
Funding quote admission checks the exact Magic owner and sender address,
canonical Arbitrum USDC amount, the requested approve/fund batch, and the
quoted fee bound. Particle v2 does not expose decoded calls in its returned
user operations, so the returned root hash is not independently proven to
contain only those calls. The first live Magic signature and finalized vault
deposit must qualify that SDK boundary before it is called working.
The mobile mandate request now calls the backend vault-provision route. A
deployer-only CREATE2 factory maps the frozen mandate hash to one Magic-owned
vault; the sidecar checks finalized factory code and route, then verifies the
deployed vault's immutable terms before Convex binds it. An atomic Convex claim
precedes a possible deployment send. An uncertain send is inspection-only until
the factory mapping is finalized; the mobile check does not broadcast again.
Provisioning defaults off and requires a reviewed factory deployment, exact
factory runtime code hash, sidecar-only executor key file, executor address,
separate provision bearer, Arbitrum RPC, and mainnet setup enablement. The
deployer/executor is a restricted Moeazi service account, never a replacement
for the Magic owner. No factory or vault has yet been deployed or funded.
Use `node --import tsx scripts/managed-vault-factory.ts init` once to create
that service key outside the repository. `prepare` compiles the factory and
quotes its exact constructor transaction without sending; `deploy` requires
an explicit `--max-cost-wei` and refuses an underfunded executor. After a
successful transaction, `verify --factory-address=<address>` reads finalized
code and the immutable deployer, USDC, WETH, and router before its runtime
hash is placed in sidecar configuration. Never copy this key into Magic or a
customer wallet, commit it, or treat a submitted factory transaction as
finalized deployment. Back up the restricted executor key before funding it;
losing it would prevent normal vault trading and Stop calls.
The vault buy path now connects a reserved finance intent to a single sidecar
dispatch and requires finalized `OrderFilled` evidence and a later vault read
before recording the fill. Stop has a separate restricted executor path and
requires a finalized stopped vault before the mandate is marked stopped. A
stopped vault can enter the reserved WETH-to-USDC close path with immutable
order binding and reconciliation-only recovery after an uncertain send. These
paths are code-connected but have not been qualified with a funded Magic
signature or real order. Mobile withdrawal now prepares the vault's exact
owner-only `withdrawUsdc()` call for Magic to sign after confirmed Stop and
flat exposure. A finalized vault `Withdrawn` event, matching canonical USDC
transfer, later empty-vault read, live finance withdrawal journal and clean
reconciliation are required before Convex closes the mandate and mobile
reports the return. A lost wallet response leaves a local attempted-send
marker so the phone checks status instead of automatically resending; after
ten minutes with capital still in the vault, a user may explicitly try the
idempotent owner-only return again. This return path is code-connected but has
not been qualified with a real Magic
signature or transfer. No vault has been deployed or funded, and live
execution remains disabled.

Active assets begin with native Arbitrum USDC
`0xaf88d065e77c8cC2239327C5EDb3A432268e5831` and WETH
`0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`. Other tokens must come through the
versioned registry and be verified on chain.

The flow is approval check, quote with string chain IDs, local typed-data signature
when required, swap preparation, strict transaction validation, `eth_call`
simulation, policy/gate checks, broadcast, and receipt reconciliation.

CLASSIC and UniswapX are different response unions. CLASSIC carries `permitData` only
with its signature. UniswapX carries the local signature but omits `permitData` from
the swap request. Quotes older than 30 seconds are rejected. Targets are allowlisted
for Arbitrum. WETH must never be entirely unwrapped automatically.

A broadcast AMM swap cannot be cancelled; it can only be reconciled.

The optional v4 hook experiment is a separate quote-and-simulation lane for one
explicitly registered USDC/WETH PoolKey. It verifies hook permission bits,
runtime bytecode hash, PoolId, and locally generated Universal Router calldata.
It never replaces Trading API best-price routing and always reports
`broadcastAllowed=false`. See
[the hook experiment](../uniswap-v4-hook-experiment.md).

## Optimism

Optimism is legacy-read-only and may appear in Particle unified balances. New
strategies must not provision or route through an Optimism execution wallet.

Legacy migration is always user-confirmed: read balances/pending transactions and
allowances, preview revocation/gas retention, confirm movement to the UA, source
assets on Arbitrum, reconcile, then archive. Never bridge, revoke, transfer, or
archive automatically.

See [Arbitrum venue architecture](../arbitrum-venue-architecture.md) and
[venue routing](../venue-routing.md) for diagrams and selection math.

## Local artifact certification

Venue Price-Safety and Liquidation Receipt is an isolated Test Center fixture proof.
It does not read venue prices, account margin, positions, funding or liquidity and
cannot influence signer, gateway, sidecar, routing or execution readiness.

Feature 05 can only compare checked-in local fixture identities in the isolated Test
Center. It is not connected to owner signing, preparation, broadcast, venue setup,
or product readiness; a passing fixture must never be described as execution
certification.
