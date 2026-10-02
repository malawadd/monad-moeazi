from time import perf_counter
from moeazi_agent.effective_authority_scenarios import NOW, _request, _gate
from moeazi_agent.effective_authority_registry import required_gate_ids
from moeazi_agent.effective_authority_reducer import reduce
def test_local_reducer_p95_under_ten_ms():
    request=_request(True); gates=tuple(_gate(g,request,n+1) for n,g in enumerate(required_gate_ids())); samples=[]
    for _ in range(1000):
        start=perf_counter(); reduce(request,gates,"Autopilot",NOW); samples.append((perf_counter()-start)*1000)
    assert sorted(samples)[949] < 10
