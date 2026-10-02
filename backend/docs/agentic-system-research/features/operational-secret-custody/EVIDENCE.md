# Evidence

Repository audit found gated AWS-KMS BYOK but incomplete access/rotation/recovery
receipts, plus legacy Convex `walletSecrets` under one environment master-key path that
conflicts with the owner model and must be retired, not certified.

NIST SP 800-57/130 (S148, S149) support class-specific key lifecycle, inventory,
protection and recovery. AWS documentation (S150) covers envelope encryption, rotation,
multi-region tradeoffs,
plaintext encryption-context visibility and irreversible ciphertext loss after key
deletion. These are mechanism sources, not authorization to provision AWS or a claim
that one provider is required. Exact links are registered in [SOURCES.md](../../SOURCES.md)
under S148–S150.

Backup copies increase compromise surface; runtime strings may not be reliably zeroed;
upstream revocation can remain unverifiable; cloud control planes can fail. No zero-
compromise, guaranteed erasure or automatic asset-recovery claim is made.

Local verification added clean/populated/rerun migration evidence, exact receipt-before-
unwrap behavior, class-complete recovery outcomes, owner-material rejection, atomic
three-prerequisite Test Center closure and separate evaluator/fake-vault/Timescale
latency measurements. This evidence supports local invariants only.
