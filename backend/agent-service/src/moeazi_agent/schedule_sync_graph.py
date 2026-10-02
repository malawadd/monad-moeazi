"""Chronological invariant checker for the local fake-owner graph."""
from __future__ import annotations
from .schedule_sync_canonical import digest
def verify(graph):
 required={"scope","state","decision","command","transitions","claim","attempt","mutation","actual","ack","root","operation","operation_hash"}
 if not required.issubset(graph): raise ValueError("schedule_sync_graph_incomplete")
 state=graph["state"]; decision=graph["decision"]; command=graph["command"]
 if state.scope_hash!=graph["scope"].scope_hash or decision.desired_hash!=state.desired_hash or (command is not None and command.desired_hash!=state.desired_hash): raise ValueError("schedule_sync_graph_scope_invalid")
 if decision.material and decision.previous_hash==state.desired_hash: raise ValueError("schedule_sync_graph_material_invalid")
 if not decision.material and decision.reason!="NO_SEMANTIC_CHANGE": raise ValueError("schedule_sync_graph_material_invalid")
 transitions=graph["transitions"]
 if decision.material and not transitions: raise ValueError("schedule_sync_graph_missing_command")
 if not decision.material and command is not None: raise ValueError("schedule_sync_graph_nonmaterial_command")
 if transitions:
  if [x.sequence for x in transitions]!=list(range(1,len(transitions)+1)): raise ValueError("schedule_sync_graph_transition_sequence")
  if transitions[-1].status!="acknowledged" or graph["ack"].desired_hash!=state.desired_hash or graph["ack"].actual_hash!=graph["actual"].actual_hash: raise ValueError("schedule_sync_graph_ack_invalid")
 if graph["operation_hash"]!=digest({"operation":graph["operation"],"request":graph["root"].request_hash}): raise ValueError("schedule_sync_graph_operation_reuse")
 if graph["mutation"].operation_performed or graph["mutation"].external_attempts or graph["mutation"].provider_cost: raise ValueError("schedule_sync_graph_effect_invalid")
 return graph
