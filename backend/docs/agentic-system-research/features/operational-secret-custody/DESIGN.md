# Future Design

Contracts: `SecretClassPolicy`, `OperationalSecretDescriptor`, `SecretHandle`,
`WrappedSecretEnvelope`, access decision/receipt, rotation plan/receipt, revocation
receipt, recovery mode/request/receipt, destruction plan, lifecycle decision and
readiness assessment. Exact tenant/class/purpose/consumer/capability, ciphertext/data-
key/KEK versions, safe AAD hash and expiry are bound.

Vault/gateway alone unwraps scoped memory; KMS/HSM supplies approved production KEK;
Convex only non-sensitive projection; Timescale receipts never ciphertext/plaintext;
Temporal workflows never plaintext; Capability owns authority/revocation; Termination
consumes state; Redis/models receive no secret or bearer handle.

Owner material is rejected. Access needs exact workload identity/purpose/capability.
Rotation verifies replacement before switch and keeps failed old revoke unknown.
Recovery never widens authority. Key drift blocks unwrap. Handles are non-enumerable
and non-bearer. KMS deletion is quorum-controlled after complete dependency inventory;
no health polling or cloud calls without cost approval.

Migrate provider ciphertext out of general SQL and legacy wallet ciphertext behind the
vault only after classifying and rejecting owner-equivalent material. Rollback keeps
affected execution disabled; it never restores broad Convex decryption.

Failure modes include KMS unavailability, access-policy drift, incomplete rotation and
unknown upstream revocation; affected capabilities stay disabled and no cached
plaintext or broader credential path is used.

The implemented local slice realizes these contracts with an in-memory AES-GCM fake
vault, exact class/workload registries, append-only Timescale metadata, an unregistered
metadata-only workflow and a 41-case Test Center corpus. Production adapters and real
record movement remain absent by design.
