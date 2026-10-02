# Recovery Continuity

## Current status

Cross-State-Owner Recovery and Continuity is implemented for checked-in local fixtures
inside the isolated Test Center. It is **not** a production restore system. No native
Convex backup, Timescale backup, Temporal recovery, external execution reconciliation,
secret-custody restore, independent storage or production infrastructure has been
validated. Product `recovery_continuity` therefore remains `UNKNOWN`.

## Domain model

| Domain | Local proof | Production status |
| --- | --- | --- |
| Convex product state | synthetic isolated export | unproven |
| Timescale history | logical fixture restore | same-failure-domain only |
| Temporal workflows | fixture histories/schedules | unproven |
| Repository release | exact frozen SHA/manifests | locally provable |
| Redis coordination | empty start and rebuild | locally provable |
| External execution | terminal synthetic submission | authoritative owner unavailable |
| Non-owner secrets | synthetic custody-availability fixture; production owner unavailable | unavailable |

Feature 04 supplies a stricter local fake-vault proof for this domain, but native
production custody recovery remains unavailable.

Recovery points retain one cutoff per domain; never describe them as globally atomic.
Redis starts empty and is reconstructed from durable owners. Temporal is a protected
domain and cannot be the only recovery orchestrator.

## Test Center operation

Feature 02 defaults off. Its observe mode requires Feature 01 observe/enforce through
capture, evaluate and project. Its isolated enforce mode requires Feature 01 isolated
enforce through all four layers. Controls are feature-scoped CAS leases and affect only
new runs. Missing Redis state restores off.

The strict candidate compares jobs/credits, proposals/approvals/fills,
workflows/schedules, release/configuration, executions/nonces/uncertainty, and Redis
reconstruction. A passing local fixture allows only inspection, previous-safe rendering
and read-only reconciliation. Normal resume, provider dispatch, reservation, proposal,
approval, signing, broadcast and mutation remain blocked.

## Rollback and incidents

Set the Feature 02 Test Center lease to off. Do not delete recovery artifacts or copy
restored fixture state into production. Keep Dependency Safety observe, recovery
continuity unknown, Manual Guard and Lite Mode on, setup/live gates off, and
reconciliation readable. External activation follows the sanitized local
`LIVE-VALIDATION.md` and needs separate cost disclosure and approval.
