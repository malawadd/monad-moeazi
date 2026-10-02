# Evidence

## Claim-to-source map

| Claim | Evidence | Status |
| --- | --- | --- |
| Current sidecar validates coarse target/sender/calldata/value and uses unpinned simulation | U20 | Repository evidence |
| Universal Router can transfer, Permit2, wrap, unwrap, nest subplans and allow failure | S88 | Production contract documentation |
| `eth_call` supports execution against a specified state context | S86 | Protocol documentation |
| `eth_simulate` proposes sequential simulation and richer effects | S87 | Emerging specification |
| EIP-712 binds structured messages to a domain but lacks replay protection | S51 | Technical standard |
| Existing Uniswap flow requires allowlisting, preparation and simulation but remains gated | U04, U20 | Repository evidence |

Sources are registered in [SOURCES.md](../../SOURCES.md).

## Evidence conclusion

An allowlisted router target can encode materially different downstream effects, so
target validation alone is insufficient. Exact decoding, domain comparison and pinned
simulation provide deterministic evidence about prepared intent. They cannot predict
state changes after the pinned block or validate unsupported semantics.

## Counterevidence and limitations

- A decoder can be wrong while reporting completeness.
- Simulation can diverge from later execution due to state, ordering, gas or provider
  behavior.
- Hosted RPCs may not expose portable state diffs.
- Dynamic targets and arbitrary hooks may be undecidable within safe bounds.
- EIP-712 does not itself prevent replay or prove user comprehension.

## Classification and freshness

S51, S86–S88 are technical or production documentation, not performance evidence.
U20 is direct repository evidence. Sources were checked on 2026-08-05. Decoder,
schema, artifact certification and simulation-context versions are stored in every
receipt and invalidate on drift.

## Claims excluded

No claim is made that simulation guarantees execution, decoding proves contract
safety, or mismatch detection prevents a given amount of loss. The 80–99% range is
restricted to a seeded prepared-artifact mutation corpus.
