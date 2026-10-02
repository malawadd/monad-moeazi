from datetime import datetime,timezone
import json
import statistics,time
from dataclasses import replace
from importlib.resources import files
import pytest
from moeazi_agent.portability_canonical import canonical_csv,normalize_path
from moeazi_agent.portability_scenarios import evaluate_fixture,scenario_registry
from moeazi_agent.portability_registry import DOMAIN_IDS,registry
from moeazi_agent.portability_canonical import digest
from moeazi_agent.portability_scope_contracts import PortabilityScope
from moeazi_agent.portability_evaluator import evaluate,replay_identity,validate_graph

NOW=datetime(2026,9,8,tzinfo=timezone.utc)
def run(row,mode="observe"): return evaluate_fixture(row["id"],mode,NOW,"operator_fixture","a"*64)
def test_closed_112_scenario_corpus_and_ten_domain_projection():
 rows=scenario_registry(); assert len(rows)==112 and len({x["id"] for x in rows})==112
 for row in rows:
  result=run(row,"enforce"); assert result["configuredDomains"]==10==result["representedDomains"]
  assert result["fixtureOnly"] and result["productOutcome"]=="unavailable" and not result["downloadAvailable"]
  assert result["authorityEffect"]=="none" and result["externalAttempts"]==result["providerCost"]==0
def test_canonical_mutation_and_path_rejection_counts():
 bad=["/x","x/../y","x\\y","x//y","x/%2e/y","x/ A","x/\x00y"]
 for value in bad:
  with pytest.raises(ValueError): normalize_path(value)
 for marker in ("=formula","+formula","-formula","@formula"):
  with pytest.raises(ValueError): canonical_csv(("domain_id","record_id","revision","value"),[{"domain_id":"x","record_id":"y","revision":1,"value":marker}])
def test_repeat_identity_and_enforce_grant_replay():
 row=next(x for x in scenario_registry() if x["id"]=="p01-01")
 first=run(row,"observe"); second=run(row,"observe"); assert first["manifestHash"]==second["manifestHash"]
 replay=run(next(x for x in scenario_registry() if x["id"]=="p06-01"),"enforce")
 assert replay["deliveryState"]=="replay_blocked" and replay["cleanupState"]=="cleared"
def test_registry_closure_and_cleanup_failure_blocks():
 assert tuple(x["id"] for x in registry()["domains"])==DOMAIN_IDS
 result=run(next(x for x in scenario_registry() if x["id"]=="p06-04"),"enforce")
 assert result["packageStatus"]=="blocked" and result["cleanupState"]=="failed"
def test_late_correction_and_out_of_order_delivery_are_rejected():
 late=run(next(x for x in scenario_registry() if x["id"]=="p05-03"),"enforce")
 assert late["packageStatus"] in {"partial","blocked"} and late["productOutcome"]=="unavailable"
 graph=evaluate({"id":"order","request":"same"},"enforce",NOW); broken=dict(graph); broken["attempt"]=replace(graph["attempt"],sequence=2)
 with pytest.raises(ValueError,match="attempt_order"): validate_graph(broken)
def test_384_independent_contract_path_and_hash_mutations():
 base=evaluate({"id":"mutation","request":"stable"},"observe",NOW); mutations=[]
 for index in range(384):
  family=index%4; altered=dict(base)
  if family==0: altered["operation"]=f"invalid-{index}" # contract enum
  elif family==1: altered["operationHash"]=f"{index:064x}" # hash binding
  elif family==2: altered["context"]=replace(base["context"],scope_hash=f"foreign-{index}") # link binding
  else:
   first=replace(base["files"][0],path=f"portability/account-profile/m-{index}.json"); second=replace(base["files"][1],path=first.path)
   with pytest.raises(ValueError): replace(base["manifest"],files=(first,second,*base["files"][2:])) # path collision
   mutations.append((family,index,digest({"family":family,"index":index}))); continue
  mutations.append((family,index,digest({"family":family,"index":index})))
  with pytest.raises(ValueError): validate_graph(altered)
 assert len(mutations)==384==len({item[2] for item in mutations})
def test_all_132_ordered_operation_non_reuse_pairs():
 operations=registry()["operations"]
 pairs=[]
 for left in operations:
  for right in operations:
   if left==right: continue
   first=evaluate({"id":"pair","request":"same","operation":left},"observe",NOW); second=evaluate({"id":"pair","request":"same","operation":right},"observe",NOW)
   reused=dict(second); reused["manifest"]=first["manifest"]
   assert first["operationHash"]!=second["operationHash"] and first["root"].root_hash!=second["root"].root_hash
   with pytest.raises(ValueError): validate_graph(reused)
   pairs.append((left,right,first["operationHash"],second["operationHash"]))
 assert len(pairs)==132==len(set(pairs))
def test_exact_72_scope_and_domain_non_reuse_cases():
 cases=[]
 for family in ("tenant","account","domain"):
  for index in range(24):
   scope=PortabilityScope("operator:fixture",f"tenant:{index if family=='tenant' else 'fixed'}",f"account:{index if family=='account' else 'fixed'}")
   bound=DOMAIN_IDS[index%10] if family=="domain" else "all"
   changed=evaluate({"id":"scope","request":"same","tenant":scope.tenant_ref,"account":scope.account_ref,"domainBinding":bound,"operation":"inspect_export"},"observe",NOW)
   prior=evaluate({"id":"scope","request":"same","tenant":"tenant:fixed","account":"account:fixed","domainBinding":"all","operation":"inspect_export"},"observe",NOW)
   reused=dict(changed); reused["manifest"]=prior["manifest"]
   with pytest.raises(ValueError): validate_graph(reused)
   cases.append((family,index,bound,scope.scope_hash,changed["root"].root_hash))
 assert len(cases)==72 and len({digest(item) for item in cases})==72
def test_10000_seeded_pure_property_replays_are_distinct_and_under_5ms_p95():
 seen=set()
 durations=[]
 for seed in range(10_000):
  row=scenario_registry()[seed%112]; started=time.perf_counter_ns(); identity=replay_identity({"operator":f"operator:{seed%32}","tenant":f"tenant:{seed%24}","account":f"account:{seed%24}","domainBinding":DOMAIN_IDS[seed%10],"operation":registry()["operations"][seed%12],"request":f"{row['id']}:{seed}"},"enforce" if seed&1 else "observe"); durations.append((time.perf_counter_ns()-started)/1_000_000)
  assert identity not in seen; seen.add(identity)
 assert len(seen)==10_000 and statistics.quantiles(durations,n=100)[94]<5
def test_16_hand_pinned_golden_vectors():
 graph=evaluate({"id":"golden","request":"golden-request","operation":"inspect_export","operator":"operator:golden","tenant":"tenant:golden","account":"account:golden"},"enforce",NOW)
 values={"json":digest(__import__("moeazi_agent.portability_canonical",fromlist=["canonical_json"]).canonical_json({"a":1,"b":"x"})),"csv":digest(canonical_csv(("domain_id","record_id","revision"),[{"domain_id":"x","record_id":"y","revision":1}])),"path":digest(normalize_path("portability/account-profile/data.json")),"file":graph["files"][0].descriptor_hash,"domain-root":graph["receipts"][0].receipt_hash,"manifest":graph["manifest"].manifest_hash,"assembly":graph["assembly"].receipt_hash,"verification":graph["verification"].receipt_hash,"grant":graph["grant"].grant_hash,"delivery":graph["delivery"].receipt_hash,"cleanup":graph["cleanup"].receipt_hash,"root":graph["root"].root_hash,"unicode":digest({"z":"é"}),"integer":digest({"n":9007199254740993}),"lineage":graph["plans"][0].plan_hash,"cutoff":graph["plans"][0].cutoff.cutoff_hash}
 pinned={x["id"]:x["value"] for x in json.loads(files("moeazi_agent").joinpath("portability_goldens.json").read_text())["vectors"]}
 assert values==pinned and len(pinned)==16
