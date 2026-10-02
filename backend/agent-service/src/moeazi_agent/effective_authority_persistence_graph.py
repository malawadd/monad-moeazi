"""Deterministic complete append-only graph for one local authority decision."""
from __future__ import annotations
from .effective_authority_canonical import digest
from .effective_authority_registry import registry_hash
TABLES=("effective_authority_registry_snapshots","effective_authority_owner_heads","effective_authority_gate_edges","effective_authority_input_manifests","effective_authority_reason_projections","effective_authority_explanations","effective_authority_enforcement_comparisons","effective_authority_transitions")
def build_persistence_graph(request,gates,decision,run_hash):
    base={"scopeHash":request.scope.scope_hash,"decisionHash":decision.decision_hash,"runHash":run_hash,"registryHash":registry_hash()}
    graph={}
    for name in TABLES:
        payload={**base,"kind":name,"gateHashes":[gate.result_hash for gate in gates]}
        graph[name]={"artifact_hash":digest(payload),"payload":payload}
    return graph
