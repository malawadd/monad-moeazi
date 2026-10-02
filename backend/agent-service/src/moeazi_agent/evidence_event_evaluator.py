"""Pure deterministic local fixture fold.  No persistence, network, or runtime imports."""
from __future__ import annotations
from .evidence_event_canonical import digest,utc
from .evidence_event_contracts import EvidenceDelivery,EvidenceEvent,QuarantineReceipt
from .evidence_event_graph import validate_graph
from .evidence_event_scope_contracts import EvidenceFixtureScope,SelectedFeature03Context
from .evidence_event_registry import EVENT_CLASSES,FAMILIES,OPERATIONS,QUALITY,registry_hash
def evaluate(scenario,mode,now,operator,request_hash,context=None,controls=None):
    if mode not in {"observe","enforce"}: raise ValueError("evidence_mode_invalid")
    if scenario.get("operation","inspect") not in OPERATIONS: raise ValueError("evidence_operation_invalid")
    if scenario.get("operator") not in (None,operator): raise ValueError("evidence_operator_invalid")
    scope=EvidenceFixtureScope(operator,scenario.get("tenant","tenant-fixture"),scenario.get("account","account-fixture"),scenario.get("scopeKind","public_market_fixture"),42161,scenario.get("market","arb-usdc"))
    context=context or SelectedFeature03Context("run-"+"a"*32,operator,scope.scope_hash)
    if context.operator_test_id!=operator or context.scope_hash!=scope.scope_hash: raise ValueError("evidence_context_scope_invalid")
    events=[]; deliveries=[]; quarantines=[]; seen={}
    for index,row in enumerate(scenario.get("timeline",()),1):
        source=row.get("source","market-data"); sid=row.get("sourceEventId",f"event-{index}"); body=row.get("body",{"value":index})
        if source not in FAMILIES or row.get("eventClass","quote") not in EVENT_CLASSES: raise ValueError("evidence_registry_member_invalid")
        if set(body)-{"value","risk","price","depth","funding","integrity","newsClass","protocolState"}: raise ValueError("evidence_body_field_invalid")
        if row.get("malformed") or not isinstance(body,dict): quarantines.append(QuarantineReceipt(scope.scope_hash,source,"PARSER_INVALID")); continue
        event=EvidenceEvent(scope.scope_hash,source,sid,int(row.get("revision",1)),row.get("eventClass","quote"),row.get("eventAt",now),row.get("observedAt",now),row.get("receivedAt",now),body,row.get("supersedesHash"))
        key=(source,sid,event.revision)
        if key in seen:
            if seen[key]!=event.event_hash: raise ValueError("evidence_same_revision_conflict")
            deliveries.append(EvidenceDelivery(scope.scope_hash,source,sid,utc(row.get("receivedAt",now))))
            continue
        if event.revision>1 and event.supersedes_hash!=next((x.event_hash for x in events if x.source_id==source and x.source_event_id==sid and x.revision==event.revision-1),None): raise ValueError("evidence_correction_invalid")
        events.append(event); seen[key]=event.event_hash; deliveries.append(EvidenceDelivery(scope.scope_hash,source,sid,utc(row.get("receivedAt",now))))
    cutoff=utc(now); quality={name:("fail" if not events else "pass") for name in QUALITY}; freshness="block_proposal" if not events else "degrade_role"; material="material" if any(x.body.get("risk",0)>0 or x.event_class=="risk_override" for x in events) else "quiet"
    ordered=tuple(sorted(events,key=lambda x:(x.event_at,x.source_observed_at,x.received_at,x.source_id,x.source_event_id,x.revision,x.event_hash)))
    manifest={"scopeHash":scope.scope_hash,"cutoff":cutoff,"eventHashes":tuple(x.event_hash for x in ordered),"missingSources":tuple(),"registryHash":registry_hash()}; manifest["manifestHash"]=digest(manifest)
    trigger={"status":"simulation_only","eventHashes":manifest["eventHashes"],"desiredWorkflowIdentity":digest({"scope":scope.scope_hash,"events":manifest["eventHashes"]}),"priority":"high" if material=="material" else "normal"}
    dispatch={"status":"runtime_unavailable","workflowStarted":False,"operationPerformed":False,"externalAttempts":0,"providerCost":0}
    analytical={"manifestHash":manifest["manifestHash"],"toolSet":tuple(),"providerProvenance":"unavailable","analyticalHash":digest({"manifest":manifest["manifestHash"],"tools":[]})}
    state={"accepted":len(events),"duplicates":len(deliveries)-len(events),"quarantines":len(quarantines),"quality":quality,"freshness":freshness,"materiality":material}; state["stateHash"]=digest(state)
    root={"requestHash":request_hash,"rootHash":""}; root["rootHash"]=digest({"scope":scope.scope_hash,"request":request_hash,"manifest":manifest["manifestHash"],"state":state["stateHash"]})
    operation=scenario.get("operation","inspect")
    return validate_graph({"scope":scope,"context":context,"events":tuple(events),"deliveries":tuple(deliveries),"quarantines":tuple(quarantines),"quality":quality,"watermarks":tuple(),"manifest":manifest,"analytical":analytical,"state":state,"root":root,"trigger":trigger,"dispatch":dispatch,"fixtureHash":digest(scenario),"operation":operation,"operationHash":digest({"operation":operation,"request":request_hash})})
