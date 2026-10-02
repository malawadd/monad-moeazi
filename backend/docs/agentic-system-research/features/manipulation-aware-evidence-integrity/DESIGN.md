# Design — Manipulation-Aware Evidence Integrity

## Separate dimensions

Never collapse these into “trusted source”:

1. source/channel identity;
2. content integrity and transformation lineage;
3. freshness/completeness;
4. independence from other items;
5. claim support/truth status;
6. injection/unsafe-content status.

A strong result in one dimension cannot erase a failure in another.

## Proposed records

### `SourceRegistryEntry`

- canonical source/publisher/channel IDs, domains, accounts, contracts, feed keys;
- trust tier, independence group, known mirrors/aggregators/upstreams;
- allowed claim classes, authoritative-primary mappings, expected cadence/freshness;
- authentication/C2PA/feed/TLS checks supported;
- active/revoked/disputed state, authorizer, version, and audit history.

New/unknown sources are research/Shadow only until governed approval.

### `SourceIntegrityRecord`

- evidence event, source/channel identity, raw/sanitized hashes;
- authentication, signature/C2PA, transport, parser, mapping, freshness, and injection
  results kept separately;
- provenance edges, cluster ID, correction/revocation state, policy version, and hash.

### `ProvenanceEdge` and `SyndicationCluster`

Edges express authored-by, quoted-from, derived-from, copied-from, corrected-by, and
superseded-by. The deterministic clustering version records canonical URL, exact/
near-duplicate signatures, quoted origin, publisher relation, and publication cascade.
One cluster contributes at most one independent evidence unit.

### `ClaimSupport`

- claim ID/class, supporting/opposing event IDs and cluster IDs;
- required/observed primary evidence and independent corroboration;
- freshness/integrity results, disputed/unknown state, and confidence cap.

### `IntegrityDecision`

- `allow | degrade | block`, maximum usable confidence, allowed claim classes;
- missing-primary, insufficient-independence, contradiction, injection, revocation, and
  quality reason codes;
- manifest/claim/source-registry/policy hashes and expiry.

The reducer never increases authority. Caps apply after model output; models cannot
choose or override them.

## Claim-class policy

Freeze a matrix for regulatory actions, protocol/security incidents, corporate/
financial disclosures, venue status, market data, and social/news sentiment. It names:

- authoritative primary endpoint requirements;
- acceptable corroboration and minimum independent clusters;
- freshness and correction rules;
- allow/degrade/block/cap behavior.

A regulatory/security/venue-status claim lacking required primary confirmation is
disputed or blocked for action eligibility, even when fresh and widely reposted.

## Injection quarantine

1. Fetchers record raw bytes in access-controlled history subject to retention rights.
2. Normalize encodings, strip active markup/hidden content, bound size, and separate
   quoted data from system instructions.
3. Detect known direct/indirect injection and obfuscation patterns; retain reason codes.
4. The prompt template labels excerpts as untrusted evidence and exposes no tools,
   policies, secrets, routes, or credentials.
5. Validate output schema and allowed evidence IDs.
6. Quarantined content is excluded or used only in explicit adversarial evaluation.

No detector is treated as complete.

## Correction and revocation

- Registry changes and source revocations are versioned and authorized.
- A correction/revocation event traverses the Timescale dependency graph to affected
  manifests, claims, syntheses, proposals, lessons, and calibration artifacts.
- Temporal starts bounded reevaluation/expiry workflows with stable IDs.
- Any unexecuted dependent proposal expires or rechecks according to policy.
- Executed history remains immutable and is marked affected; it is not rewritten.

## Ownership

- Timescale: detailed events, bodies, registry history, lineage, clusters, integrity,
  claim support, and dependencies.
- Convex: bounded current source/readiness/integrity and proposal-impact summaries.
- Redis: short-lived hashes, clustering candidates, and hot registry cache only.
- Temporal: durable reevaluation/correction workflows. No Convex polling.

## Cost and latency budget

- Exact hashes, registry lookup, and rule checks run synchronously; near-duplicate or
  embedding-assisted cluster candidates may run asynchronously but cannot delay a
  critical block decision or create authority while pending.
- Track added ingest CPU, storage per retained payload/edge, registry and clustering
  latency, quarantine-review load, and correction fan-out cost.
- The later implementation must freeze per-source ingest and pre-analysis gate latency
  budgets. Exceeding them makes evidence stale/degraded according to policy rather than
  bypassing the integrity gate.

## Failure behavior

- Unknown source or missing integrity record: Shadow/research only or block per class.
- Cluster ambiguity: count conservatively as one independence unit.
- Compromised primary: registry revocation plus required independent/onchain
  corroboration; identity alone never passes truth.
- Integrity service failure: fail closed for action eligibility.
- False-positive quarantine: operator review may restore source status, not execute a
  trade or bypass historical evaluation.

## Later implementation sequence

1. Reuse the Evidence Event Fabric registry/manifest; do not create another.
2. Fix citation identity and add source/lineage contracts.
3. Add deterministic exact/near-duplicate clusters and claim-class matrices.
4. Add injection quarantine and adversarial fixtures.
5. Add correction/revocation propagation in Shadow.
6. Consider production gating only after precision/recall and false-positive review.

Rollback restores the prior integrity policy version; revocation/correction history is
never discarded.
