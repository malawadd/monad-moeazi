"""Pure synthetic schedule reconciliation; never imports Temporal or performs IO."""
from __future__ import annotations
from .schedule_sync_canonical import digest,utc
from .schedule_sync_scope_contracts import ScheduleFixtureScope
from .schedule_sync_state_contracts import DesiredMarketSchedule,DesiredScheduleState,MaterialChangeDecision,ActualScheduleObservation
from .schedule_sync_command_contracts import ScheduleSyncCommand,CommandTransition,DispatchClaim,ReconciliationAttempt,ScheduleMutationObservation,ScheduleSyncAcknowledgement
from .schedule_sync_result_contracts import ScheduleSyncRoot,ScheduleSyncProjection
from .schedule_sync_graph import verify
from .schedule_sync_registry import OPERATIONS,registry_hash
def evaluate(scenario,mode,now,operator,request_hash,controls=None):
 if mode not in {"observe","enforce"}: raise ValueError("schedule_sync_mode_invalid")
 if scenario.get("operation","inspect") not in OPERATIONS: raise ValueError("schedule_sync_operation_invalid")
 if scenario.get("operator") not in {None,operator}: raise ValueError("schedule_sync_operator_invalid")
 scope=ScheduleFixtureScope(operator,scenario.get("tenant","tenant-fixture"),scenario.get("account","account-fixture"),scenario.get("profile","profile-fixture"))
 rows=scenario.get("markets",[{"marketId":"arb-usdc","cadence":"15m"}])
 markets=tuple(DesiredMarketSchedule(x["marketId"],x.get("cadence","15m"),bool(x.get("paused",False))) for x in rows)
 state=DesiredScheduleState(scope.scope_hash,int(scenario.get("revision",1)),scenario.get("previousRevision"),scenario.get("lifecycle","active"),bool(scenario.get("profilePaused",False)),scenario.get("manualGuard","off"),"on",int(scenario.get("modelConfigRevision",1)),markets)
 previous=scenario.get("previousHash")
 material=not bool(scenario.get("nonmaterial",False)) and previous!=state.desired_hash
 decision=MaterialChangeDecision(previous,state.desired_hash,material,"MATERIAL_CHANGE" if material else "NO_SEMANTIC_CHANGE")
 command=ScheduleSyncCommand(scope.scope_hash,state.profile_revision,state.desired_hash) if material else None
 at=utc(now); actual_members=tuple((x.market_id,"15m",state.effective_state!="scheduled") for x in (markets[:1] if state.effective_state=="scheduled" else ()))
 actual_hash=digest({"scope":scope.scope_hash,"revision":state.profile_revision,"schedules":actual_members})
 actual=ActualScheduleObservation(scope.scope_hash,state.profile_revision,actual_hash,len(actual_members),at)
 transitions=(); claim=attempt=mutation=ack=None
 if command:
  retry=bool(scenario.get("retry",False)); transitions=(CommandTransition(command.command_id,1,"pending","dispatching",at,"CLAIMED"),)
  if retry: transitions+=(CommandTransition(command.command_id,2,"dispatching","retry_wait",at,"LOST_ACK"),CommandTransition(command.command_id,3,"retry_wait","dispatching",at,"RETRY_READBACK"),)
  transitions+=(CommandTransition(command.command_id,len(transitions)+1,"dispatching","acknowledged",at,"MATCHED_READBACK"),)
  claim=DispatchClaim(command.command_id,2 if retry else 1,"lease-"+digest({"command":command.command_id,"at":at})[:32],at); attempt=ReconciliationAttempt(command.command_id,claim.attempt,"matched",actual_hash); mutation=ScheduleMutationObservation(command.command_id,True); ack=ScheduleSyncAcknowledgement(command.command_id,state.desired_hash,actual_hash,at)
 else:
  command=ScheduleSyncCommand(scope.scope_hash,state.profile_revision,state.desired_hash); mutation=ScheduleMutationObservation(command.command_id,False); ack=ScheduleSyncAcknowledgement(command.command_id,state.desired_hash,actual_hash,at); claim=DispatchClaim(command.command_id,1,"lease-"+"0"*32,at); attempt=ReconciliationAttempt(command.command_id,1,"suppressed",actual_hash)
 root=ScheduleSyncRoot(scope.scope_hash,request_hash,state.desired_hash,actual_hash)
 graph={"scope":scope,"state":state,"decision":decision,"command":command if material else None,"transitions":transitions,"claim":claim,"attempt":attempt,"mutation":mutation,"actual":actual,"ack":ack,"root":root,"operation":scenario.get("operation","inspect"),"operation_hash":digest({"operation":scenario.get("operation","inspect"),"request":request_hash}),"registryHash":registry_hash(),"fixtureHash":digest(scenario)}
 if not material: graph["command"]=None
 verify(graph); return graph
