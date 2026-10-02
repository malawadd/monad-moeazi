# Q2 recorded-replay qualification

2026-09-30. **Pass scope: native/Pydantic/PostgreSQL recorded-replay software.**
Independent Sol verification and supervisor acceptance are restricted to the
corpus, policies and behaviors below. Continuous clock/source readiness,
forward-shadow admission and native live account observations remain unqualified.

## Frozen corpus and configuration

The [dataset manifest](q2-dataset-manifest.json) identifies ten exact raw payloads.
Manifest byte SHA-256:
`db959f379c326917d4893701f986acb7e8a24b33f4edb709d4e27a47b246c539`.
All ten raw hashes were checked locally; no timestamp or raw payload was rewritten.
The replay table was generated from these bytes in `.data/q2-replay-matrix.json`.

The corpus uses internal qualification rights only, replay maximum age 120,000 ms,
and `q2_internal_research_v1`. These are experiment settings, not approved production
freshness limits or commercial data rights. The replay cutoff is the later of the
recorded receipt and event time, so a future event still fails availability checks.
Native metadata fixes instrument identities; unknown minimums remain unknown.
Perpetual asset units, multiplier and margin/funding descriptions are explicit
registry inputs; this test does not certify their native settlement implementation.

| Recorded input (relative to `.data/`) | Observed result |
| --- | --- |
| `q2-capture/spot-meta.json` | Spot metadata parsed; native instrument and units retained |
| `q2-capture/perp-meta.json` | Perpetual metadata parsed separately from spot inventory |
| `q2-capture/perp-book.json` | Excluded: `event_after_availability` |
| `q2-capture/spot-book.json` | Excluded: `event_after_availability` |
| `q2-clock-capture/sample-0.json` | Excluded: `event_after_availability` |
| `q2-clock-capture/sample-1.json` | Excluded: `event_after_availability` |
| `q2-clock-capture/sample-2.json` | Excluded: `event_after_availability` |
| `q2-runtime-capture/spot-book.json` | Excluded from qualification: clock step during capture |
| `q2-runtime-capture/perp-book.json` | One accepted native snapshot; no continuity/finality invented |
| `q2-runtime-spot-capture/spot-book.json` | Excluded: `event_after_availability` |

The accepted BTC snapshot hash is
`758da14a7617e93b3cb35b144a5ea85b0de5d5fc34416dabfea644fb2dab43b0`.
Its event preceded receipt by 553.742 ms. Its wall/monotonic request durations agree
within 0.05 ms; the test's 50 ms comparison is only a capture diagnostic, not a
production clock tolerance. Another spot sample had a stable elapsed interval but
was still over one second ahead of receipt and correctly failed admission.
The clock-step exclusion is a corpus qualification decision, not a claim that a
continuous runtime clock-health service has been implemented.

## Verification boundaries

- Native response tests preserve exact price/size strings, source bytes, venue and
  instrument identity, availability, snapshot-only semantics and absent finality.
- Fault tests cover reused symbols, wrong decimals/precision, malformed types,
  changed duplicate payloads/rights/times, sequence collisions/gaps, future/late/
  stale/reorg observations, crossed/unsorted books and unapproved rights/price rules.
  Reordering observations produces the same accepted snapshot hash.
- Actual SQL056 tests reparse native-format bytes before storing normalized values;
  forged normalized content fails. Immutable versions/events/snapshots reject direct
  update/delete. UTC/hash and nested position JSONB roundtrips are verified.
- Account observation storage accepts explicitly synthetic experiment fixtures;
  it cannot bootstrap live balances. Database fixtures are not native account proof.

The focused suite comprises `test_stage2_observation_contracts.py`,
`test_stage2_observation_replay.py`, `test_stage2_observation_postgres.py`,
`test_stage2_native_capture.py` and `test_stage2_native_runtime_capture.py`.
SQL tests require the guarded disposable database; recorded-data tests explicitly
skip when these local artifacts are absent. A future checkout without those bytes
cannot inherit this qualification from an ordinary green test summary.
Independent focused replay/native checks passed 43/43; actual SQL056 storage checks
passed separately, 2/2. These results do not include the unresolved operational
clock/source readiness gate.

## Source identity and remaining gates

Local source byte hashes at qualification:

| Module under `agent-service/src/moeazi_agent/` | SHA-256 |
| --- | --- |
| `native_observations.py` | `17296b2aef81a5421680260abf63fd303ee9123e047827c1d4ede9c16f3a86c1` |
| `observation_contracts.py` | `2b78d97da58a24fa0eff6f84957afdd17188a87824f4ae32e5a2ab3d5ff903f5` |
| `observation_replay.py` | `6b8766e170acc07edbcb63cc93d90423ab12ab4cbd9afd0fb5c7b6441369a3cd` |
| `observation_storage.py` | `ca660ec9e6185e4d8837d61f3fd9f4941674a0dbf612dab69cde397c421f6dbe` |
| `account_observation_storage.py` | `78a8ea20be6390d847e6ce9d09f2d7b07158740e5bf66c3d79d6109abf543142` |

SQL056 SHA-256 is
`170b978a1103375c05ed08dd79c865f0a779a566fa42e45576336389733c13e0`.
Relevant source, registry, rights, policy or dataset changes invalidate the affected
result and require rerunning it.

Forward/live use still requires sustained clock health, positive native spot
admission, continuous stream/reorg handling where claimed, operational data rights
and native account/finality adapters. A database fixture also encountered a runtime
clock discontinuity; the strict future-time rejection was preserved. Historical
fixture windows can isolate software tests, but do not repair that operational
defect. No application or OS timing tolerance was loosened to obtain this pass.
