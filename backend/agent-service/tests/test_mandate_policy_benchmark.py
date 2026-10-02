import statistics, time
from datetime import datetime, timezone
from moeazi_agent.mandate_policy_scenarios import evaluate_fixture, scenario_registry

def test_mandate_policy_fixture_p95_under_10ms():
    now=datetime(2026,1,1,tzinfo=timezone.utc); rows=scenario_registry(); samples=[]
    for index in range(100):
        started=time.perf_counter(); evaluate_fixture(rows[index % len(rows)]["id"],"enforce",now,"operator","a"*64); samples.append((time.perf_counter()-started)*1000)
    assert statistics.quantiles(samples,n=100)[94] < 10
