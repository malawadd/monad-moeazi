"""Real PostgreSQL harness for Feature 23; requires local POSTGRES_DSN."""
import asyncio,os
from sqlalchemy.ext.asyncio import create_async_engine
from moeazi_agent.customer_contestation_scenarios import NOW,build_artifacts,scenario_registry
from moeazi_agent.customer_contestation_storage import ContestationRepository,ContestationConflict
async def main():
 dsn=os.environ["POSTGRES_DSN"]; engine=create_async_engine(dsn); repo=ContestationRepository(engine); a=build_artifacts(scenario_registry()[0],NOW,"a"*64)
 payload={"runId":"run-"+"a"*32,"fixtureHash":"a"*64}; first=await repo.persist_bundle("operator:harness","key-a","a"*64,a,payload); assert first==await repo.persist_bundle("operator:harness","key-a","a"*64,a,payload)
 try: await repo.persist_bundle("operator:harness","key-a","b"*64,a,payload)
 except ContestationConflict: pass
 else: raise AssertionError("changed request did not conflict")
 for point in ("after_scopes","after_submissions","after_cases","after_findings","after_responses","after_corrections","after_remedy_receipts"):
  try: await repo.persist_bundle("operator:fail",point,"c"*64,a,payload,point)
  except RuntimeError: pass
  else: raise AssertionError(point)
 await engine.dispose(); print("customer_contestation_repository_harness: PASS")
if __name__=="__main__": asyncio.run(main())
