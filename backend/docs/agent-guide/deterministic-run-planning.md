# Deterministic evidence-delta run planning

Feature 34 is a local Test Center fixture only. It compares checked-in evidence deltas
against complete Focus, Pro, and Max plans, then returns `skip`, `full_run`, or
`abstain`. It never schedules analysis, refreshes snapshots, reserves credits, calls a
provider, or changes a product mode. Feature 25 and 29 inputs are explicit same-operator
context and remain `requires_revalidation`.

Unknown, stale, corrected, gapped, risky, budget-invalid, or conflicting inputs abstain.
A skip retains the previous fixture snapshot without extending freshness.
