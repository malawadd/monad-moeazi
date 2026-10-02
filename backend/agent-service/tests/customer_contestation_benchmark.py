"""Pure 10k evaluator latency benchmark for checked-in local scenarios."""
import time
from moeazi_agent.customer_contestation_scenarios import NOW,build_artifacts,scenario_registry
from moeazi_agent.customer_contestation_evaluator import evaluate
fixtures=[build_artifacts(row,NOW,f"{i:064x}") for i,row in enumerate(scenario_registry())]; times=[]
for i in range(10_000):
 a=fixtures[i%96]; start=time.perf_counter(); evaluate({**a,"appeal_pending":bool(i%2),"reviewer_conflict":bool(i%3==0)}); times.append((time.perf_counter()-start)*1000)
p95=sorted(times)[9499]; assert p95<5,p95; print(f"customer_contestation_pure_p95_ms={p95:.3f}")
