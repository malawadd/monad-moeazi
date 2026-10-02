# Authoritative risk and reconciliation fixtures

Feature 09 is an isolated Test Center fixture plane. It freezes synthetic
Arbitrum-42161 source observations, evaluates exact integer capacity, records
hash-linked snapshots and reservations, and retains uncertain attempts in a
reconciliation hold. It has no Convex projection, normal API route, execution
workflow, signing, venue adapter, RPC, provider, or external-network path.

The Test Center result is explicitly local-only. It does not make product risk,
reconciliation, capacity, inclusion, settlement, or execution available. Missing,
stale, disputed, cross-scope, malformed, or expired observations fail closed.

Timescale fixture tables are append-only. Redis is not an authority or a durable
record; the local result never releases capacity for a possible submission, partial
state, drift, or reorg. Feature 10 remains the future owner of journal settlement.
