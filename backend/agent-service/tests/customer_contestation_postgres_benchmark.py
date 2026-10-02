"""Measures actual per-write local PostgreSQL fixture latency; requires POSTGRES_DSN."""
import asyncio,os,time
from sqlalchemy.ext.asyncio import create_async_engine
from moeazi_agent.customer_contestation_scenarios import NOW,build_artifacts,scenario_registry
from moeazi_agent.customer_contestation_storage import ContestationRepository
async def main():
 engine=create_async_engine(os.environ["POSTGRES_DSN"]); repo=ContestationRepository(engine); times=[]
 for i in range(40):
  start=time.perf_counter(); a=build_artifacts(scenario_registry()[i%96],NOW,f"{i:064x}"); await repo.persist_bundle(f"operator:bench-{i}",f"key-{i}",f"{i+1:064x}",a,{"runId":f"run-{i:032x}","fixtureHash":f"{i:064x}"}); times.append((time.perf_counter()-start)*1000)
 p95=sorted(times)[37]; assert p95<100, p95; print(f"customer_contestation_per_write_p95_ms={p95:.3f}"); await engine.dispose()
if __name__=="__main__": asyncio.run(main())
