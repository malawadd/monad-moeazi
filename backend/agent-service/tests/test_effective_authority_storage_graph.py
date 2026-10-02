from moeazi_agent.effective_authority_scenarios import NOW, _request, _gate
from moeazi_agent.effective_authority_registry import required_gate_ids
from moeazi_agent.effective_authority_reducer import reduce
from moeazi_agent.effective_authority_persistence_graph import TABLES, build_persistence_graph
def test_full_graph_is_deterministic_and_closed():
    request=_request(True); gates=tuple(_gate(x,request,i+1) for i,x in enumerate(required_gate_ids())); decision=reduce(request,gates,"Autopilot",NOW)
    graph=build_persistence_graph(request,gates,decision,"a"*64)
    assert tuple(graph)==TABLES and graph==build_persistence_graph(request,gates,decision,"a"*64)
    assert all(len(row["artifact_hash"])==64 for row in graph.values())
