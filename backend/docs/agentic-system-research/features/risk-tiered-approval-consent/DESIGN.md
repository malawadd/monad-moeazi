# Design — Risk-Tiered Approval Quality and Consent Receipts

## Contracts

`ApprovalRiskAssessment` consumes only authoritative proposal, risk/sizing/reservation,
EAD, route/preflight/quote, exposure/drawdown, evidence/uncertainty, venue novelty and
cost receipts. A versioned deterministic tier selects required fields, presentation,
expiry, authentication, and ceremony. Missing/stale/disputed never lowers the tier.

`ApprovalPacket` binds owner/account, user agent, chain `42161` for EVM, venue,
market/side/order/TIF/size/leverage, exact receipt IDs/hashes, cost/stress/uncertainty,
simulation-versus-submit status, material bounds, policy/profile/config revisions,
issued/expiry, one-time nonce, schema/reducer version, and idempotency key.

`ApprovalConsentReceipt` records packet hash, expected Particle/Magic owner, signer
method, domain, nonce, accepted/declined/expired result, verification metadata, and
time. It is evidence, not an execution capability.

`PostApprovalComparison` compares a fresh risk/EAD/route/quote/preflight set to every
signed bound and records favorable, neutral, or material deltas. `ApprovalInvalidation`
has stable reason and supersession IDs.

## Ceremony and signer flow

- Low/ordinary: concise packet and one final explicit acceptance/signing step.
- Elevated: changed/risk fields foregrounded, short expiry, and fresh authentication.
- High/novel/near-limit: owner step-up and deliberate review required by deterministic
  tier policy; repeated clicks are not treated as comprehension.

Define a venue/capability matrix. Where the protocol transaction signature is the
fresh consent, present the full packet immediately before Particle/Magic signing. For
a restricted delegated path, packet consent may authorize only that existing bounded
path. Avoid a separate consent signature plus action signature unless required and
measure prompt count.

EIP-712 binds application/verifier, chain/account/owner, packet/proposal hash, nonce,
and expiry. Atomically verify and consume the expected current nonce once. Wrong owner,
domain, chain, account, packet, expiry, or replay fails.

## Post-approval flow

1. Temporal waits for one current packet and expires/supersedes it durably.
2. After acceptance, reload profile, mode, policy, emergency state, authoritative risk,
   reservation, EAD, route, and fresh quote.
3. Run the complete deterministic preflight.
4. Compare every field with the signed envelope.
5. Invalidate and reissue on material/unfavorable/route/authority/policy/risk/
   uncertainty/expiry change; retain favorable/non-material comparisons.
6. Invoke the real owner signing/dispatch path only if all execution gates pass.

A change from a certified private/protected channel to a less-private channel is
always material, even when price and size are unchanged. It requires a new packet
that names the new channel and property loss; a broad venue approval cannot silently
authorize the downgrade.

Packet or consent alone can never dispatch.

## Storage, idempotency, and privacy

- Convex owns the current inbox, packet state, and atomic nonce consumption.
- Timescale owns immutable packet, render, comparison, consent, and invalidation history.
- Temporal owns wait, expiry, requote, comparison, and reissue workflow.
- Redis cannot be sole replay protection. Use append retry/outbox semantics across
  stores and stable packet/idempotency keys.

Store only necessary signature proof/hash and verification metadata. Raw replayable
signatures are transient or encrypted and access-controlled. No signature, secret,
credential, raw evidence, or hidden reasoning enters model inputs or general traces.

## Rollout, latency, and rollback

Packet generation adds local milliseconds; owner review/requote adds human and network
latency and can expire in volatile markets. Roll out generation-only in Shadow,
Approval dry-run, user study, then certified Approval. Rollback blocks new packets and
preserves receipts; it cannot fall back to generic approval.

Failure modes include stale quotes, changed material deltas, expired signer sessions
and receipt mismatch; every case requires a fresh packet and deterministic recheck.
