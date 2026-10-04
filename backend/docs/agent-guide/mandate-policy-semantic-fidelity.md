# Mandate-to-policy semantic fidelity

Feature 18 is a local, isolated Test Center fixture only. Its typed `MandateSpec`,
compiler, coverage receipt, semantic diff, one-use synthetic consent and immutable
activation-chain artifacts prove deterministic fixture behavior. They never create,
edit or activate a customer policy.

The existing Convex drafting and activation paths remain legacy/unmapped and unchanged.
They are not evidence of mandate fidelity. Product adoption requires a separately
authorized Convex migration and explicit user review. The fixture has no signer,
wallet, venue, provider, network or execution import; its boundary receipt always
reports product and effective authority as unavailable and authority effect as none.

Run only a checked-in scenario through the allowlisted Test Center with the normal
feature lease. Observe records no fixture head. Isolated enforce can append a synthetic
activation receipt. Rollback recompiles and reconfirms a typed mandate; it never
demotes or creates a customer policy. Disable the feature lease to demote access while
preserving migration 030's append-only evidence.
