# Operator console and research subsystem comparison

The requirement is a separate local interface connected to Moeazi's backend. It must show real configuration and results, create experiments, and later request controlled releases. It must not become a second trading runtime, credential store, or disconnected research database. Existing interfaces remain available.

## Compare the alternatives

| Option | Reuse gained | Integration cost and boundary | Recommendation |
| --- | --- | --- | --- |
| Thin Moeazi console over existing APIs | Team ownership, model budgets, evaluation plans, Timescale history, Temporal lifecycle, and current safety scenarios | New UI/BFF and program/release APIs; missing lifecycle/accounting still must be implemented | **Adopt architecture.** React/TypeScript local UI; choose exact frontend artifacts from the repository-compatible dependency set during Stage 4 |
| Hummingbot Dashboard + API | Strategy/backtest/bot views, direct trading/account operations, portfolio queries | Brings Hummingbot bot/account/credential semantics, backend services and deployment control; not just a frontend skin | **Borrow patterns. Defer whole-stack adoption** unless Q5/Q10 demonstrates a narrow reusable subsystem |
| MLflow | Parameter/metric/artifact tracking, experiment comparison and model registry | Generic registry does not express account consent, venue authority, position management or program release eligibility | **Defer optional research adapter.** Existing Lab remains experiment owner; no second assignment registry |
| Optuna Dashboard | Trial history, search parameter importance, optimization inspection | Requires Optuna studies; not a trading console, ledger, or release workflow | **Defer specialized view** until bounded optimization is useful |
| Static HTML export | Portable inspection of frozen results | Cannot safely own durable jobs, account monitoring, or release operations | **Adopt as optional report export only**, not the primary console |

## Hummingbot source findings

Dashboard is Apache-2.0; Hummingbot API is MIT at the reviewed revisions. Do not assume all repositories in a product family share one license. Source references and hashes are in [U1/U2](evidence-register.md#new-upstream-inspection).

The inspected Dashboard configuration defaults its authentication switch off and has backend credential defaults. Its requirements include Streamlit. The inspected API trading router exposes order placement, cancellation, positions, and history via account/connector services; its Compose file includes a host Docker socket and an EMQX image. These source facts explain why adoption would be a substantial operating/security integration, not a shortcut to a harmless local viewer. [Dashboard configuration](https://github.com/hummingbot/dashboard/blob/ee42595bec85518eda0b9fe1a56046d09a3e36c6/CONFIG.py), [API deployment](https://github.com/hummingbot/hummingbot-api/blob/d276034aee978d826bf05afcc2197eb1360c4a6a/docker-compose.yml).

The deployment's exact container/transitive licenses were not fully reviewed. A broad image tag is not an approved OSS artifact manifest. Do not import Docker control or exchange-key management into Moeazi research workers. Tailscale/other hosted conveniences in upstream installation instructions are not selected dependencies.

**Q5 comparison:** represent one Moeazi frozen program, experiment and result in a read-only adapter prototype. Measure extra backend state, translation code, and lost semantics. Reject the full stack if it requires duplicate credentials, authoritative order state, deployment ownership, or replacement of Temporal/Convex account semantics. Borrow program comparison and position-executor UI concepts without inheriting defaults.

## MLflow source and documentation findings

MLflow is Apache-2.0. Reviewed source identifies development version `3.16.2.dev0`; it is not a selected installation version. Official tracking documentation supports parameters, metrics, artifacts, and database-backed model registry workflows. [Tracking documentation](https://mlflow.org/docs/latest/ml/tracking/), [reviewed version](https://github.com/mlflow/mlflow/blob/f130e764257080e33de1c5cdb263e98ca02c099d/mlflow/version.py).

Use it only if model/factor artifacts and comparisons outgrow the existing Lab enough to offset another service/dependency. Moeazi experiment IDs would remain canonical; an MLflow run is a linked research artifact. A model registry alias must never directly activate a customer program.

**Q5/Q6 comparison:** export one frozen experiment to a disposable self-hosted instance and round-trip its parameters, data/code hashes, metrics and artifacts. Reject if existing UI delivers the same value with less duplication, lineage is lost, or optional cloud storage becomes mandatory. Large artifacts create storage/backup costs independently of the OSS license.

## Optuna Dashboard findings

MIT license and Python >=3.10 are visible in the inspected files. Its documentation describes study visualization and a browser-only variant with reduced functionality. The browser-only option is useful for immutable exports, not backend job or release authority. [Project](https://github.com/optuna/optuna-dashboard), [documentation](https://optuna-dashboard.readthedocs.io/en/latest/).

**Q6 comparison:** once an Optuna search is justified, link a study to the Moeazi experiment and display all trials, including failures. Keep the holdout unavailable to search. Reject adopting it as the entire console or using it to hide failed searches behind a winning parameter set. No proprietary service is required for the core dashboard, but compute, data, and model calls remain separate costs.

## Selected console behavior

Stage 4 adds a local operator interface with authenticated backend access. Its initial functions are inspect program/configuration, clone/freeze a candidate, preview an experiment, run/cancel, compare results, and inspect a decision. Release controls appear only in Stage 7 after their backend exists.

The UI must distinguish:

- Current backend configuration versus a local draft or source-code default.
- Synthetic fixtures, recorded replay, forward shadow, and observed live outcomes.
- Program eligibility versus account readiness versus operator authorization.
- Experiment cancellation versus position closure; the latter is not a research UI action.

No live demo values substitute for unavailable state. If the managed mobile assignment is missing, the console presents that gap and permits candidate research without claiming activation.

## Backend integration

Reuse existing Evaluation v2 preview/freeze/budget and customer-research ownership patterns, but add explicit operator scopes rather than impersonating a customer. Use stable program/experiment IDs and SSE/event cursors for progress. Bounded refresh for current views is acceptable; no worker polling Convex for jobs.

Keep experiment artifacts in existing Timescale-backed storage with approved lifecycle/retention. Extend Temporal tasks and isolate simulated account namespaces. An optional artifact browser such as MLflow is a view/integration, not another source of assignments or truth.

Keep Test Center, Evaluation Lab, and customer research pages intact. The console calls a narrow bridge for synthetic scenarios without expanding the Test Center's network capability. Its operator token cannot grant a fixture producer the right to attest real risk or signing readiness.

## Research recommendation change

The earlier report deferred MLflow largely to avoid duplicating the Lab. That conclusion remains, but now includes a concrete console/artifact comparison experiment. Hummingbot Dashboard/API are newly reviewed alternatives, not ignored possibilities. A thin console is selected because Moeazi already owns much of the useful backend and has incompatible authority requirements; Q5 can overturn this choice if a narrower adopted subsystem demonstrably reduces work without introducing conflicting owners.
