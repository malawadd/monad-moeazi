# Future Design

## Contracts

`ClockDomainSpec` declares domain type/source, monotonic/wall/venue/chain semantics,
uncertainty limits, comparable domains and allowed operations. `TimeHealthObservation`
records `[earliest, latest]`, offset/dispersion/authentication/jump state and expiry.
`ValidityInterval`, typed `CausalLink` and `TemporalSafetyDecision` bind exact subjects,
receipts and policy. `NonceDomainSpec` defines protocol/signer scope and uncertainty;
`NonceLease` records nonce, signer fingerprint, acted-for account, artifact/idempotency
binding and durable lifecycle.

## Rules

- Independent domains are incomparable unless a current spec permits comparison.
- Timestamp order never proves causality. An operation is definitely valid only when
  the entire observed-now interval lies within the permitted interval; overlap is
  unknown and blocks risk increase.
- Chain order uses block/hash/finality; venues use native sequences/cursors/nonces;
  processes use monotonic elapsed time.
- Near an uncertain budget boundary, reserve conservatively against both buckets or
  block.
- Nonce algorithms are protocol-specific. Hyperliquid scope is the signing API wallet,
  including multiple acted-for accounts. EVM nonces use a separate domain.
- Stable idempotency returns the same nonce/artifact binding. Signed or possibly
  submitted nonces are never released/reused.

## Ownership and failure behavior

A deterministic library owns interval math/contracts. Gateway/sidecar owns allocation
and sign-time enforcement. Timescale stores observations/leases/links/decisions with
unique constraints; Convex current status; Temporal expiry/recovery; Redis accelerates
but is not durable authority.

Unsafe/unknown/expired time, gap or nonce conflict blocks new risk. Certified safe
operations remain. Particle/Magic ownership is unchanged.

## Rollout/cost

Inventory every freshness/expiry/budget/nonce gate, migrate fixtures first, then Shadow
decisions and signer integration. Target local decision p95 below 5 ms excluding an
already-required durable mutation. Rollback blocks new signing rather than returning
to raw `Date.now()`. No paid time/RPC service is required.
