# Operational Secret Custody

## Current status

Feature 04 is implemented only as a checked-in, in-process fake-vault proof. The
operator-allowlisted Test Center can run synthetic observe and isolated-enforce
fixtures after all three prerequisite leases are frozen. Product availability remains
`unavailable`. No real record, provider, cloud KMS/HSM, wallet, venue, signer, or
external revoke path is connected.

Particle and Magic remain the only owner roots. Owner private keys, seeds, reusable
signatures, recovery phrases, fallback keys, and owner-equivalent legacy
`walletSecrets` shapes are categorically rejected or quarantined. They are never a
recoverable custody class.

## Boundary and contracts

The checked-in class registry assigns exactly one outcome to every class: BYOK uses
`reenter`; platform/provider/data/venue/service/infrastructure credentials use
`reissue`; restricted venue delegates use `replace`; vault data keys use `rewrap`;
vault access bindings use `restore_access`; owner material is `forbidden`.

Only named versioned fixture workloads are admitted. Browser/UI, models, agent
orchestration, generic workers, Temporal payloads, Redis consumers, and arbitrary
callers cannot use a handle. A handle is an opaque non-bearer descriptor/version
reference. Every access requires a fresh exact tenant, class, purpose, consumer,
capability, policy, AAD and version decision.

The fake vault owns AES-256-GCM fixture envelopes and fake KEKs in memory. Timescale
owns immutable metadata decisions, authorized-attempt and terminal receipts,
lifecycle transitions, readiness results and legacy dispositions. It has no material
columns. Redis retains only feature-scoped leases. The unregistered Temporal workflow
accepts only opaque IDs, target versions, hashes and idempotency identity.

## Lifecycle and recovery

Access persists an authorized-attempt receipt before unwrap, invokes one registered
callback, best-effort overwrites the mutable buffer, and appends a terminal receipt.
Python cannot guarantee memory erasure, so no zeroization claim is made.

Rotation verifies a replacement before compare-and-swap cutover. Local revoke disables
local access; upstream status stays `unknown` unless a provider later reports it, and
is never labeled externally verified. Recovery is an exact subset of the active
policy and cannot create owner approval. Local destruction simulation requires a
complete inventory and two distinct synthetic reviewers. Product readiness is always
`unavailable`, even when the local fixture outcome is ready.

## Legacy quarantine and rollback

The classifier reads checked-in shape metadata only. It never reads a real reference,
value, subject, address, display fragment, fingerprint, envelope, or environment
value. Existing provider and venue records remain in place and untrusted.
`walletSecrets` owner-equivalent and unknown shapes remain quarantined with the
associated capability disabled.

Rollback turns only the Feature 04 Test Center lease off and discards the in-memory
fake vault. Immutable local receipts remain; no legacy row changes and no broad
decrypt fallback is restored. Production activation needs separately approved vault
infrastructure, row-level migration, owner-material exclusion, native recovery,
workflow registration, certified execution boundaries, and cost disclosure before
any billable cloud action.
