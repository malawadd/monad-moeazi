# Operator Qualification and Drill-Readiness Ledger

Feature 17 is an isolated local/Test Center fixture ledger. It records checked-in
synthetic identities, role/module/drill/rubric versions, deterministic oracle receipts,
calibration, independent review, grant, revocation, and consumption attempts. It is not
workforce identity, competence, product authority, or incident readiness.

The decision order is scope/version validation, candidate training, a bounded
fake-adapter drill oracle, fresh independent synthetic review, and a short-lived fixture
grant. Any hard failure, drift, expiry, revocation, alias/self review, nonhuman review,
or unknown consumer blocks. Consumer bindings for Features 14–16 are local receipts and
never call or alter their evaluators.

Migration 029 stores append-only local history. Redis holds only the existing two-hour,
feature-scoped Test Center lease; loss or expiry is off. There is no Convex, Temporal,
product, workforce/LMS, provider, wallet, signer, venue, or network path. Output always
says product qualification `unknown`, product outcome `unavailable`, and authority
effect `none`. Enable only through default-off local Test Center controls and demote by
resetting the feature lease; rollback never rewrites evidence.
