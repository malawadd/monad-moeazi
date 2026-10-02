# Evidence

## Claim-to-source map

| Claim | Evidence | Status |
| --- | --- | --- |
| Current redaction/settings lack a complete enforced purge lifecycle | U25 | Repository evidence |
| Privacy lifecycle includes minimization, access, retention and deletion | S109 | Voluntary government framework |
| Sensitive telemetry should be filtered/transformed before export | S110 | Production guidance |
| Sanitization and cryptographic erase require bounded conditions and verification | S111 | Government guidance |
| Minimization/storage limitation/accountability are legal concepts | S112 | Legal analogy; applicability unassessed |
| Public onchain activity cannot receive an ordinary application deletion guarantee | S113 | Official ecosystem documentation |

Sources are registered in [SOURCES.md](../../SOURCES.md).

## What it establishes

The evidence supports early minimization, sink-specific policy and explicit deletion
outcomes. It does not prove GDPR or other legal applicability, full secret detection,
provider erasure or that a hash is anonymous.

## Limitations and counterevidence

- Unknown encodings and semantic aliases can evade classifiers.
- Transform processors add latency and can remove needed debugging evidence.
- Cryptographic erase fails if uncontrolled plaintext copies exist.
- Backups and providers may expose only unverifiable deletion status.
- Low-entropy personal data remains guessable when merely hashed.

## Classification and freshness

S109 and S111 are government guidance, S110 production guidance, S112 legal text used
only as analogy, and S113 public-chain documentation. U25 is repository evidence. All
were checked on 2026-08-05. Policy, schema, processor and copy-inventory versions are
bound to receipts.

## Claims excluded

Never claim legal compliance, guaranteed deletion, onchain erasure or anonymization
without applicable legal analysis and complete copy-level proof.
