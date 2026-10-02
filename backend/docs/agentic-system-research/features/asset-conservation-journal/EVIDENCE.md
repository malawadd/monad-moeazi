# Evidence

## Claim-to-source map

| Claim | Evidence | Status |
| --- | --- | --- |
| Existing asset execution/audit records are not a balanced exact-unit journal | U23 | Repository evidence |
| Financial transfers can enforce debit/credit conservation | S99, S102 | Production system documentation |
| Pending transfers can post, void or expire immutably | S100 | Production system documentation |
| Stable identifiers support retry-safe submission | S101 | Production system documentation |
| ERC-20 transfers emit standard events | S103 | Technical standard |
| Settlement-finality/linked-obligation concepts support explicit state | S104 | Conventional-market analogy |

Sources are registered in [SOURCES.md](../../SOURCES.md).

## Evidence conclusion

The sources support immutable balanced postings, pending resolution and stable event
identity. TigerBeetle guarantees do not transfer automatically to Timescale, ERC-20
logs do not cover all economic effects, and PFMI is analogy—not legal applicability.

## Limitations

- A perfectly balanced journal can reproduce a false or incomplete observation.
- Nonstandard tokens, fee-on-transfer, rebases, bridges and venue internals need typed
  adapters; unsupported semantics must remain unknown.
- Unrealized PnL and notional are not settled customer assets.
- Cross-asset value conservation requires valuation and is deliberately excluded.
- Backfill cannot reconstruct unobserved pre-cutoff history.

## Classification and freshness

S99–S102 are product documentation, S103 a standard, S104 market-infrastructure
guidance used only as analogy, and U23 direct repository evidence. Sources were
checked on 2026-08-05. Event-taxonomy, asset-unit, finality and adapter versions bind
every transaction/check.

## Claims excluded

The journal is not a custody statement, statutory books-and-records system, proof of
external truth or loss-prevention mechanism. Any defect reduction is limited to an
enumerated mutation corpus.
