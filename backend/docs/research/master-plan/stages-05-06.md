# Stages 5–6: research qualification and native execution

## Stage 5 — Quantitative and agent research

**Outcome:** strategies, model contributions and grounding methods have reproducible evidence, and an operator can identify qualified candidates or an honest no-candidate result.

**Prerequisites/artifacts consumed:** Q1–Q5 passing; frozen datasets and cost-aware lifecycle; experiment console; bounded budgets; an initial instrument/strategy universe selected for research, not implicitly approved for customers.

**Deliverables and boundaries:**

- Register deterministic baselines, statistical/ML alternatives, chronological train/validation/holdout periods, overlap purging, decision-time availability rules, search budgets and rejection criteria before evaluation.
- Adopt scikit-learn for baseline/calibration comparisons after package qualification. Prototype Qlib only behind the dataset/strategy contracts; compare identical costs and fills. Add Optuna only when a fixed search protocol is justified.
- Repair citation provenance in ordinary orchestration and Lab: preserve model-selected references and supplied references separately. Verify claim/source support, time, numerical calculation receipts and uncertainty; invalid or insufficient evidence can cause abstention.
- Compare deterministic-only, single-model and bounded team variants on identical contexts. Agent roles propose/challenge/test; account risk and execution remain deterministic services.
- Measure claim support, numerical error, abstention quality, calibration, strategy net outcomes and resource cost. Ragas/current judges are secondary measured instruments, not ground truth.
- Prototype RD-Agent only in an isolated offline sandbox with allowlisted datasets/tools, no execution credentials, controlled network, quotas and artifact review. Preserve existing model routing/cost control through an adapter or reject integration.
- Compare simple allocation against CVXPY only when multiple exposures justify optimization; exact post-rounding policy checks stay outside the solver.
- Build an outcome dataset from actual labeled replay/shadow/live evidence without mixing them. New research may propose versions; it cannot modify an active program.

**Proposed API/type surface:** `StrategyArtifact`, `ModelArtifact`, `CalculationReceipt`, `GroundedClaim`, `QualificationResult`, `CandidateDecision`; register artifacts with code/data/feature/policy hashes and environment; link decisions to complete experiment history including failures.

**Selected components/custom work:** existing Pydantic/Temporal/provider routing plus scikit-learn; bounded native feature/calculation tools, temporal retrieval and claim verification. Qlib/RD-Agent/CVXPY are prototypes with fallbacks. LangGraph, PydanticAI, DSPy and retrieval services remain optional/deferred until a measured gap supports them.

**Migration:** retain old analyses and scores with original schemas. Do not retroactively claim citations were verified. New versions have explicit grounding/calibration status; legacy confidence is not converted into a calibrated probability.

**Acceptance/failure scenarios (Q6–Q9):**

1. Seed lookahead via publication time, revised data, normalization fit and overlapping labels; pipeline rejects or excludes it. LLM training knowledge remains a separate contamination limit.
2. Reproduce feature/strategy outputs from frozen artifacts; report all attempted variants, cost sensitivity, turnover, exposure-matched benchmarks and uncertainty. Never select on repeated holdout reuse.
3. Seed fabricated citation IDs, true-but-irrelevant sources, unsupported prose, stale figures, unit errors and instruction-bearing retrieved text. Measure false acceptance and abstention against independently labeled cases.
4. A team's apparent consensus cannot override failed numeric checks. Removing an agent measures incremental value/cost; reported confidence alone does not certify contribution.
5. Generated code cannot reach credentials, customer data, live execution or unlimited compute. A failed sandbox or uncontrolled provider path rejects RD-Agent integration.
6. Infeasible/inaccurate/timeout solver outputs cannot become orders. Rounding and shared-collateral constraints still pass deterministic checks.

**Completion evidence:** preregistered protocols, reproducible research manifests, ablation/grounding scorecards, candidate decisions and negative results. Infrastructure completion may end with **no qualified strategy**; funded customer release then remains blocked. No return, drawdown, leverage or loss threshold is invented by this report: responsible owners must set and freeze decision criteria before running selection experiments.

**Rollback:** withdraw a candidate qualification or research feature; active customer versions do not change. Preserve experiment lineage and judge versions. **Costs:** training compute/data/model judges/discovery calls may be billable. Use recorded/offline tests first; estimate named services and per-run/trial limits before approval. **Still unavailable:** native-certified submission and managed mobile live release.

## Stage 6 — Native execution qualification

**Outcome:** each selected venue/account/instrument combination has demonstrated authority, order/fill recovery, protection, collateral and withdrawal behavior under a narrowly defined capability certificate.

**Prerequisites/artifacts consumed:** Q1–Q9 results, with all safety prerequisites passing; frozen Q10 test specification; account/risk/supervisor contracts; exact SDK/contract manifests; production secret-management decision. A negative strategy result permits read-only/offline adapter qualification but does not authorize funded use.

**Deliverables and boundaries:**

- Select the first spot and perpetual qualification tracks based on complete operation coverage, custody constraints, data/cost fit and residual authority. They may pass at different times; a venue name alone is not a release.
- Implement native operation adapters exclusively inside gateway/sidecar; reuse Particle/Magic owner signers and exact supported smart-account/venue-grant paths.
- Qualify delegated-secret lifecycle, key access boundaries, nonce/client-ID handling, independent reconciliation, chain finality/reorg and external order discovery.
- Replace placeholder financial risk inputs with Stage 2 snapshots/reservations and use current authority checks immediately before dispatch. Stale/missing state blocks new exposure.
- Qualify continuous protection and close/cancel behavior, fees/funding, collateral transfers, withdrawal availability and recovery. Document native limits that application policy cannot cryptographically enforce.
- Produce per-operation certification with exact code/dependency/contract/policy hashes, environment, observed results, expiry and invalidation triggers. Existing synthetic certification fixtures cannot issue it.

**Proposed API/type surface:** `VenueCapabilityManifest`, `NativeGrant`, `ExecutionPermit`, `SubmissionReceipt`, `VenueObservation`, `CapabilityCertificate`; adapter methods `prepare/sign/submit/cancel/reduce/close/reconcile/fund/withdraw` declare unsupported operations explicitly. No generic successful fallback.

**Selected components/custom work:** native SDKs and existing execution boundary; optional CCXT only for operations independently qualified. Hyperliquid SDK, Uniswap preparation and compatible permission modules are candidates, not settled first launch choices. No broad external engine gets an owner key.

**Migration:** opt-in adapter capability registry; retain current disabled paths until equivalent certificates exist. Moving account authority requires revocation/rotation and reconciliation, not merely updating a connection row. Changes to contracts, permission modules or signing code invalidate relevant certificates.

**Acceptance/failure scenarios (Q10):**

1. Test wrong chain, account, token, spender/router, selector, nonce, amount, expiry and revoked scope. Both Moeazi policy and native permission outcomes are recorded.
2. Lose submission responses, crash signer/reconciler, retry cancels, duplicate fills and introduce external orders. Stable identity and reservations prevent duplicate exposure; unresolved state quarantines safely.
3. Exercise partial entry and failed protective child, stop trigger during disconnect, funding/margin changes and reduced collateral. Report actual protection limitations.
4. Reconcile spot/perp and gas/fee/funding balances to observed settlement. Transfer/withdrawal remains pending until verified, including bridge or owner-signature requirements.
5. Analysis budget exhaustion cannot disable protection; operator kill blocks new entries without silently deleting native protective orders.
6. Available test-environment results are followed by an explicitly approved bounded funded qualification when required. Mainnet behavior cannot be certified from fixtures alone.

**Completion evidence:** Q10 signed qualification bundle, independent financial reconciliation, explicit unsupported operations and residual authority, recovery runbook, secret/permission review. No certificate for a venue lacking a critical close/protection/reconciliation path.

**Rollback:** revoke certificate, block new risk, continue authorized protection on compatible code, reconcile and drain before revoking credentials needed for exits. Never roll back by restoring a broad key or blind resubmission.

**Costs:** RPC/API limits, gas, bridging, venue fees, funding, infrastructure and potential trading loss are cost-bearing. Before each funded/probe action give the service, expected usage/cost or unknowns, and request explicit approval. This brief is not that approval. **Still unavailable:** broad customer enrollment or unqualified venues; Stage 7 consent/release gate remains required.
