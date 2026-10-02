# Outcome-calibrated promotion and demotion

Feature 36 is an isolated, deterministic Test Center fixture. It evaluates
checked-in synthetic paired observations and returns immutable local receipts for
`eligible`, `hold`, `reject`, `demote`, `block`, or `kill`. The precedence is fixed:
`kill > block > demote > reject > hold > eligible`; no composite override exists.

Eligibility is only `request_explicit_review`. It never activates a configuration.
Demotion and rollback are modeled receipts and never change product configuration,
customer mode, policy, prompt, route, schedule, wallet, venue, signer, or execution.
Feature 33 and 35 selections are explicit, same-operator, and always
`requires_revalidation`; their labels are not positive evidence. All attempts and
cost counters stay zero. Fixture history is append-only Timescale data; Redis remains
only the existing Test Center control lease.
