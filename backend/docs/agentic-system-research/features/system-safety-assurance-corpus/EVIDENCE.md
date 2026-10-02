# Evidence — System Safety Assurance Corpus

## Claim-to-source map

| Claim | Source | Status and limit |
| --- | --- | --- |
| Existing adversarial cases are narrow and feature validation is fragmented | [U16](../../SOURCES.md#unimoazi-sources) | Direct repository/dossier evidence |
| AI TEVV benefits from lifecycle metrics, tests, challenge problems and testbeds | [S58](../../SOURCES.md#external-sources) | Government program guidance, not certification |
| Assurance cases structure claims, arguments, and evidence | [S59](../../SOURCES.md#external-sources) | Government tooling/research; evidence argument can still be incomplete |
| Declarative policy tests can execute positive/negative decisions and report coverage | [S60](../../SOURCES.md#external-sources) | Production documentation; not whole-system assurance |

## Novelty and overlap

The corpus does not replace Evaluation Lab, feature `VALIDATION.md` files, policy tests,
or runtime code. Its independent value is composition: one versioned registry can test
stale evidence plus malformed analysis plus budget retry plus approval expiry plus
ambiguous broadcast and verify cross-layer invariants. Local dossiers remain owners of
their detailed cases.

## Limitations and counterevidence

- Test and mutation coverage cannot enumerate all real failures or prove absence of a
  vulnerability.
- A surviving mutant may be equivalent/inapplicable; a killed mutant may be trivial.
  Every adjudication must be explicit.
- Combinatorial scenario growth can make full runs expensive and slow.
- An oracle that reimplements business logic can agree with the same bug.
- Random source mutation can damage the user's worktree or produce meaningless scores;
  only curated semantic mutations in isolated copies are permitted.
- NIST/OPA sources do not validate an 85% target or quantify defect reduction.

## Freshness

Sources were checked on 2026-08-05. Corpus artifacts expire when referenced invariant,
schema, owner, route, policy, feature, or test hashes change. A stale artifact yields
`stale`, never inherited support.
