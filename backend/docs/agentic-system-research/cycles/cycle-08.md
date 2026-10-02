# Cycle 08 — Protocol Saturation: A2A, MCP, and Onchain Trust

## Research question

Would current agent interoperability, capability, or onchain trust protocols improve
Unimoazi enough to justify widening its closed analytical and execution boundaries?

## Candidate results

| Candidate | Result | Score | Audit conclusion |
| --- | --- | ---: | --- |
| A2A-style analytical interoperability | Reject | 43 | Dynamic discovery/task/delegation duplicates fixed routes and Temporal while adding attack, cost and tenant surfaces |
| MCP-style read-only evidence adapters | Hold/fold | 72 | Add static internal adapter manifests and bounded queries to Evidence Fabric; no MCP runtime/tool plane |
| Onchain agent identity/reputation/staking/attestation | Reject | 40 | Draft registries prove neither truth nor performance and add cost, privacy, Sybil and governance risk |

## Protocol lessons retained

- Interoperability protocols are valuable for independent opaque agents. Unimoazi has
  fixed roles, strict reports, deterministic routes/quorum, bounded spend, traces, and
  Temporal-owned work; no current provider requires another task protocol.
- Capability schemas, allowlists, input/output validation, scopes, budgets, and audit
  are useful. They belong in a code-reviewed internal `EvidenceAdapterManifest`; the
  model never lists or calls tools and only sees sanitized immutable EvidenceEvents.
- Cryptographic/onchain origin and hash commitments do not prove analytical truth,
  forecast skill, non-collusion, safety, or authority. Local outcomes and provenance
  are more direct evidence for this product.

## Rejected variants

- A2A discovery, Agent Cards, task lifecycle, callbacks, negotiation, multi-turn remote
  delegation, or external agents satisfying critical-role/family quorum.
- MCP runtime, dynamic tool/resource discovery, model-selected calls, arbitrary URIs,
  credentials in context/Temporal, or raw tool results bypassing quarantine.
- ERC-8004 registry/reputation/staking, validator authority, identity tokens, inference
  truth claims, public customer/strategy metadata, or unapproved onchain writes.

## Stop-condition state

This cycle approved **zero** new dossiers. Together with Cycle 07, the consecutive
zero-approval count is **2**. The research program stops under its agreed rule.
