# Evidence — Manipulation-Aware Evidence Integrity

## Claim-to-source map

| Claim | Evidence | Strength |
| --- | --- | --- |
| Provenance can represent identity, activity, derivation, and revision | W3C PROV, source S25 | Standard; not truth proof |
| Media manifests can cryptographically bind provenance assertions | C2PA, source S38 | Technical standard; trust-model limited |
| An official social channel can publish false market-moving information after compromise | SEC incident, source S39 | Official incident evidence |
| Prompt injection requires separation, sanitization, least privilege, validation, and monitoring | OWASP, source S40 | Security guidance; no guaranteed detection rate |
| Poisoning/evasion/misuse have distinct threat/mitigation classes | NIST, source S41 | Government taxonomy; no silver bullet |

## Evidence boundaries

- Authentication proves channel identity, not claim truth or absence of compromise.
- C2PA proves manifest/content binding under its trust model, not semantic correctness.
- Onchain timestamps prove inclusion/time, not economic interpretation.
- Duplicate clustering has false merges and splits.
- No source supports the researched attack-detection percentages.

## Counterevidence and limitations

- Novel legitimate sources may be blocked.
- Independent publishers may share an undisclosed upstream.
- Adversarial paraphrases evade similarity clustering.
- A compromised primary source can pass identity checks.
- Aggressive quarantine can suppress genuine breaking events.

## Evidence freshness

Standards, incident material, security guidance, and current code were checked on
2026-08-05. Source registries, official endpoints, keys, and revocations require
continuous governed maintenance.
