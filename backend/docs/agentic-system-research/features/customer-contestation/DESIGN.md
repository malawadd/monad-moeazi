# Future Design

Strict contracts: `ContestationPolicyVersion`, `ContestationSubmission`,
`ContestationCase`, `InvestigationScope`, `InvestigationEvidenceReference`,
`InvestigationActionReceipt`, `CaseFinding`, `CustomerResponse`, `AppealRequest`,
`AppealDecision`, `RemedyProposal`, `RemedyAuthorization`, `RemedyExecutionReceipt`,
and `CaseClosureReceipt`.

Lifecycle: submitted → authenticated → triaged → investigating → finding-issued →
response-delivered → appeal window/pending → appeal-decided → remedy/no-remedy →
closed. Results distinguish substantiated, partial, not substantiated, insufficient
evidence, outside scope, duplicate and withdrawn.

Convex owns current customer state/inbox; Timescale immutable history; Temporal waits/
deadlines; qualified humans findings; legal owners policy; domain owners corrections;
Operator Qualification reviewer eligibility; Redis no truth. Evidence Lifecycle
handles attachments/PII.

No LLM adjudication/final findings/remedy; no automatic refund, credit, trade, reversal
or authority change. Allegations remain allegations. Corrections append through domain
supersession. Live safety may trigger a separately owned restrictive incident. Appeals
use a genuinely independent reviewer when promised. Attachments are bounded and
sanitized before persistence.

External helpdesk/legal/identity/messaging may be billable and requires approval;
local synthetic design is unmetered.

## Local fixture boundary

The local implementation stores synthetic append-only artifacts in migration 035 and
returns only a redacted aggregate projection. No Convex/Temporal/Redis customer owner,
external communication, identity assertion, model adjudication, or remedy execution is
implemented. A remedy receipt is always non-executing.

## Failure and rollback

Unavailable evidence yields `insufficient_evidence`, never a guessed finding. Delivery
failure leaves the case open and retries idempotently; missed deadlines escalate to a
human. Rollback disables new intake/remedy proposals while preserving immutable cases,
appeals and already-authorized domain receipts. It never deletes history or reverses an
external effect automatically.
