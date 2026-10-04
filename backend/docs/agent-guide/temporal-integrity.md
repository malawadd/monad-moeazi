# Temporal integrity

Feature 06 is a local, fixture-only envelope for clock-domain declarations,
uncertainty intervals, native causal links, and signer-scoped nonce leases. It is
not a time service, signer, chain-finality owner, nonce oracle, or product gate.

The Test Center can run frozen capture, evaluation, projection, and isolated
enforcement simulations. Product availability remains unavailable. Redis is only
the existing expiring Test Center control lease; Timescale history is the intended
durable fixture record. Losing Redis cannot create or release a nonce.

The evaluator permits risk-increasing fixture work only when the full observed
interval is inside the half-open validity interval, health is bounded, and typed
sequence plus causal evidence are present. Timestamps alone never establish
causality. Safe-lane fixtures are evaluated independently.

Future activation needs named authoritative clock, chain, venue, and signer owners,
production storage validation, independent review, and separately approved costs.
No live validation is authorized by this local implementation.
