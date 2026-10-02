# Evidence — Evidence Event Fabric

## Claim-to-source map

| Claim | Evidence | Strength |
| --- | --- | --- |
| Provenance benefits from identity, derivation, versioning, and reproducibility concepts | W3C PROV, source S25 | Standards vocabulary; not a truth guarantee |
| Data pipelines should define correctness, freshness, coverage, and downstream SLOs | Google SRE, source S26 | Production reliability guidance |
| Database/event dual writes require an outbox plus idempotent ordered consumers | AWS outbox, source S27 | Production architecture guidance |
| Log delivery and external side effects still require explicit idempotency/reconciliation | Kafka design, source S28 | Production system documentation |
| Unimoazi's optional ingestor is fixed-loop and material-event consumption is unfinished | Source U10 | Direct implementation/project evidence |

## Evidence boundaries

- PROV lineage can show origin and transformation; it cannot show that a venue, news
  source, or model is truthful.
- At-least-once delivery is expected. “Exactly once” is not claimed across Timescale,
  Redis, Temporal, Convex, and providers.
- Vendor/server event time can be wrong; local receipt time must remain separate.
- Source retention and content rights may prevent complete raw historical replay.

## Counterevidence and limitations

- Event systems add adapter, schema, watermark, and recovery complexity.
- Thresholds can miss gradual changes or cause storms near boundaries.
- Quiet markets still need a maximum-staleness backstop.
- Some sources provide no stable event ID or resumable cursor.
- Corrected events must not be mistaken for duplicates.

## Evidence freshness

Sources and the current ingestor/architecture were checked on 2026-08-05. Revalidate
adapter capabilities, source licenses, and data-retention policies before implementation.
