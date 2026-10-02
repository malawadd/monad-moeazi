"""Authoritative local graph verifier.  Never accepts a caller supplied verdict."""
from __future__ import annotations
from .evidence_event_canonical import digest,utc
def validate_graph(graph):
    required={"scope","context","events","deliveries","quality","watermarks","manifest","analytical","state","root","trigger","dispatch","operation","operationHash"}
    if not required.issubset(graph): raise ValueError("evidence_graph_incomplete")
    scope=graph["scope"].scope_hash; events=graph["events"]; hashes=[x.event_hash for x in events]
    if len(hashes)!=len(set(hashes)) or any(x.scope_hash!=scope for x in events): raise ValueError("evidence_graph_event_scope")
    identities={}
    for event in events:
        key=(event.source_id,event.source_event_id,event.revision)
        if key in identities: raise ValueError("evidence_graph_revision_duplicate")
        if event.revision>1 and event.supersedes_hash not in hashes: raise ValueError("evidence_graph_correction_predecessor")
        identities[key]=event.event_hash
    delivery_hashes={x.delivery_hash for x in graph["deliveries"]}
    if len(delivery_hashes)!=len(graph["deliveries"]) or any(x.scope_hash!=scope for x in graph["deliveries"]): raise ValueError("evidence_graph_delivery_scope")
    ordered=tuple(sorted(events,key=lambda x:(x.event_at,x.source_observed_at,x.received_at,x.source_id,x.source_event_id,x.revision,x.event_hash)))
    manifest=graph["manifest"]
    if tuple(x.event_hash for x in ordered)!=manifest["eventHashes"] or manifest["scopeHash"]!=scope: raise ValueError("evidence_graph_manifest_order")
    if any(utc(x.source_observed_at)>manifest["cutoff"] for x in events): raise ValueError("evidence_graph_future_leakage")
    root=graph["root"]
    expected=digest({"scope":scope,"request":root["requestHash"],"manifest":manifest["manifestHash"],"state":graph["state"]["stateHash"]})
    if graph["operationHash"]!=digest({"operation":graph["operation"],"request":root["requestHash"]}): raise ValueError("evidence_graph_operation_reuse")
    if root["rootHash"]!=expected or graph["dispatch"].get("workflowStarted") or graph["dispatch"].get("operationPerformed") or graph["dispatch"].get("externalAttempts") or graph["dispatch"].get("providerCost"): raise ValueError("evidence_graph_root_or_effect")
    return graph
