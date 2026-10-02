# Future Design

Contracts: `PortabilityPolicyVersion`, `PortabilityRequest`, `DomainExportPlan`,
`DomainExportSnapshotReceipt`, `PortableExportManifest`, `ExportAssemblyReceipt`,
`TransientDeliveryGrant`, `ExportDeliveryReceipt`, and typed `OmissionRecord`/
`ExportFailure`.

Each domain records its native cutoff/cursor, query/schema version, counts, hash and
`complete|partial|unavailable|omitted|blocked`; request time is never a fake global
snapshot. JSON/CSV plus schema/README and canonical manifest are preferred; no remote
BagIt payloads.

Convex owns request/status and atomic single-use grant; Timescale immutable receipts;
Temporal assembly/retry/expiry/cleanup; Redis no authority/archive. Prefer bounded
streaming; staging must be encrypted, transient and explicitly approved.

Fresh Particle/Magic account authentication and step-up are required, not an onchain
signature. Never export keys, credentials, reusable signatures, auth headers, hidden
reasoning or other tenants. Export cannot mutate/correct/delete/trade/grant authority.
Partial is explicit; public chain data is labeled/reference-only; retries preserve ID.

## Failure modes and rollback

Unavailable domains produce explicit omissions; assembly or delivery failure revokes
the grant and cleans approved staging after its retention window. Rollback disables new
requests, preserves manifests/receipts and never re-enables an expired download.
# Implemented local design boundary

The Test Center represents exactly ten registry domains once in a manifest. Files are
assembled into a bounded in-memory map, descriptor and manifest hashes are verified, and
buffers are overwritten and cleared. Observe computes `would_issue`; isolated enforce folds
only simulated grant, delivery, replay, expiry/revocation and cleanup state. No bearer,
URL, archive, download, product mutation, or external effect exists.
