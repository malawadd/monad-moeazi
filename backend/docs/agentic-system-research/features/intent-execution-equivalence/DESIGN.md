# Future Design

## Contracts

`FrozenExecutionEnvelope` references existing proposal, route, risk, capability,
certification, consent and policy hashes, plus account/chain/sender; allowed operations,
targets, recipients and assets; maxima for input/value/gas; minimum protected outputs;
deadline, nonce/domain, expected postconditions, idempotency key and expiry.

`DecodedExecutionPlan` records the exact artifact hash and recursively decoded calls,
commands, subplans, Permit2/approval/transfer/wrap operations, recipients, values,
deadlines, nonces, allow-revert behavior, typed-data domain/message, decoder and
certification versions, and completeness.

`SimulationContext` binds block number/hash, sender/account, balances, allowances,
nonce, code/config/certification hashes, RPC source and expiry—never implicit `latest`.

`ObservedStateDelta` classifies balance, allowance, position/order, log, call and gas
changes as expected, permitted or unexplained.

`IntentEquivalenceReceipt` is `pass | fail | unknown` and includes every input hash,
invariant result, simulation result, exact bytes or typed-data hash, implementation
versions and expiry. All schemas are strict.

## Comparisons and limits

Exact match is required for chain, sender/account, target, recipient, asset, selector,
operation, domain, verifying contract, nonce and artifact hash. Input/value/gas cannot
exceed approved maxima; output protection cannot weaken; deadline cannot extend and
must remain live.

Unknown selectors, unresolved recipients, unsupported nesting, ambiguous amounts,
unexplained deltas or incomplete decoding return `unknown` and block. Decode depth,
command count, calldata bytes and simulation gas have deterministic ceilings.
Allow-revert and conditional subplans require explicit allowed postconditions.

## Flow and ownership

1. Existing owners freeze and hash the execution envelope.
2. The certified sidecar/gateway decodes exact prepared bytes and checks artifacts.
3. It simulates at a pinned context and evaluates strict postconditions.
4. Timescale stores detailed plans/receipts; Convex stores bounded current status;
   Temporal owns durable retry/reconciliation. Redis may cache no authority.
5. Particle/Magic signing rechecks freshness and exact hash parity. Dispatch compares
   the same bytes again.

Any block/context, quote, route, policy, consent, capability, certification or byte
change invalidates the receipt. Stable idempotency is retained across safe reprepare.

## Sequencing, rollback, cost and latency

Begin with Universal Router/Permit2 recorded fixtures and local simulation, then GMX
typed transactions. Run Shadow dual validation before Approval dry-runs. Rollback
blocks affected preparation; it cannot fall back to target-only validation.

Costs are decoder engineering, RPC reads/simulation and storage; no model cost is
required. Target added p95 is under 750 ms on a warm local/fork context and under 2
seconds on an allowed remote simulation, measured against artifact expiry.

Failure modes include unsupported calldata, proxy drift, unpinned state, simulation
disagreement and byte changes after review; each invalidates equivalence and blocks
dispatch.
