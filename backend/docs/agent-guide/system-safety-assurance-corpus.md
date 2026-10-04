# System Safety Assurance Corpus

Feature 27 is a default-off, local Test Center corpus of checked-in synthetic safety
claims, deterministic oracles, semantic mutations, immutable local results and four
truthful evidence states: supported, unsupported, incomplete and stale.

It is not safety certification, production evidence, a product gate, or execution
authority. Observe records the fixture comparison; isolated enforce can only block a
synthetic Test Center qualification. Manual Guard and Lite Mode remain hard ceilings.
The feature has no provider, network, model-oracle, signer, wallet, venue, Convex or
Temporal path. Timescale migration 039 stores only append-only local fixture metadata;
Redis retains only the existing expiring Test Center control lease.

Run `python -m pytest agent-service/tests/test_system_safety_assurance_corpus.py`
and `npm run system-safety-assurance:check` locally. Missing/stale bindings, an
unmapped critical claim, or a surviving critical mutation must leave qualification
blocked. Future activation requires independent qualified reviewers, authoritative
claim owners and evidence, protected release infrastructure, and separate approval.
