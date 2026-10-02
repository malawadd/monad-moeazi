"""Pure closed replay evaluator; it records no incident mutation or external attempt."""
from __future__ import annotations
from datetime import datetime, timedelta
from .incident_communication_canonical import digest
from .incident_communication_contracts import IncidentAudienceResolution, IncidentCommunicationPolicy, SafetyIncidentRevisionRef
from .incident_communication_events import IncidentAcknowledgementReceipt, IncidentDeliveryReceipt, IncidentDispatchOutboxRow, IncidentMessage
from .incident_communication_decisions import IncidentCommunicationBundleDecision, IncidentCommunicationTransition


def policy() -> IncidentCommunicationPolicy:
    body={"policy_id":"customer_safe_in_app","version":"v1","classification":"customer_safe","channel":"in_app","audience_roles":["owner","safety_delegate"],"template_version":"v1","safe_fields":["reason_code","revision","severity","state"],"acknowledgement_deadline_seconds":30,"retry_schedule_seconds":[5,10],"max_attempts":3,"escalation_role":"safety_delegate","prohibited_data_classes":["address","command","credential","diagnostic","secret","signature","url"]}
    return IncidentCommunicationPolicy(**body, policy_hash=digest(body))


def evaluate(revision: SafetyIncidentRevisionRef, *, now: datetime, cross_tenant: bool=False,
             failure: str | None=None, duplicate: bool=False, stale_ack: bool=False,
             wrong_recipient: bool=False, superseded: bool=False) -> dict:
    item_policy=policy(); resolution_body={"revision_hash":revision.revision_hash,"policy_hash":item_policy.policy_hash,"tenant_fingerprint":revision.tenant_fingerprint,"membership_revision":1,"audience_id":"audience:owner","recipient_fingerprint":"recipient:owner","role":"owner","eligible":not cross_tenant,"reason":"cross_tenant" if cross_tenant else "eligible","resolved_at":now}
    audience=IncidentAudienceResolution(**resolution_body,resolution_hash=digest(resolution_body))
    if not audience.eligible:
        body={"revision_hash":revision.revision_hash,"outbox_count":0,"displayed_count":0,"acknowledgement_count":0,"superseded_count":0,"dead_letter_count":0,"external_attempts":0,"provider_cost":0,"incident_authority_effect":"none","outcome":"blocked"}
        decision=IncidentCommunicationBundleDecision(**body,decision_hash=digest(body))
        return {"_policy":item_policy,"_revision":revision,"_audiences":[audience],"_messages":[],"_rows":[],"_deliveries":[],"_acks":[],"_transitions":[],"_decision":decision,"baselineOutcome":"unavailable","candidateOutcome":"blocked","actualOutcome":"blocked","currentCount":0,"supersededCount":0,"deadLetterCount":0,"displayCount":0,"acknowledgementCount":0,"authorityEffect":"none","externalAttempts":0,"providerCost":0,"decisionHash":decision.decision_hash,"policyHash":item_policy.policy_hash,"productOutcome":"unavailable","invariantVerdict":"pass"}
    facts=sorted([revision.reason_code,revision.severity,revision.state,f"revision_{revision.revision}"])
    content=f"Safety notice: {revision.severity} {revision.reason_code}; revision {revision.revision}."
    message_body={"revision_hash":revision.revision_hash,"audience_resolution_hash":audience.resolution_hash,"policy_hash":item_policy.policy_hash,"template_version":"v1","kind":"resolved" if revision.state=="resolved" else "corrected" if revision.revision>1 else "opened","fact_codes":facts,"rendered_copy":content,"redaction_decision":"allowlisted","template_hash":digest({"template":"v1"}),"content_hash":digest({"facts":facts})}
    message=IncidentMessage(**message_body,message_hash=digest(message_body))
    row_body={"incident_id":revision.incident_id,"revision":revision.revision,"audience_id":audience.audience_id,"template_version":"v1","channel":"in_app","dispatch_id":digest({"incident_id":revision.incident_id,"revision":revision.revision,"audience_id":audience.audience_id,"template_version":"v1","channel":"in_app"}),"message_hash":message.message_hash,"pending_at":now,"acknowledgement_deadline":now+timedelta(seconds=30),"attempt_ceiling":3}
    row=IncidentDispatchOutboxRow(**row_body,row_hash=digest(row_body))
    transition_body={"row_hash":row.row_hash,"predecessor_hash":None,"state":"intent_created","observed_at":now}; transitions=[IncidentCommunicationTransition(**transition_body,transition_hash=digest(transition_body))]
    deliveries=[]; acks=[]; display_count=0; dead=0; superseded_count=0
    if superseded:
        receipt_body={"row_hash":row.row_hash,"message_hash":message.message_hash,"attempt":1,"predecessor_receipt_hash":None,"display_idempotency_key":f"display:{row.dispatch_id[:40]}","transport_acceptance":"not_applicable","outcome":"superseded","failure_reason":"none","observed_at":now,"terminal":True}
        deliveries.append(IncidentDeliveryReceipt(**receipt_body,receipt_hash=digest(receipt_body))); superseded_count=1
    elif failure:
        prior=None
        for attempt in range(1,4):
            receipt_body={"row_hash":row.row_hash,"message_hash":message.message_hash,"attempt":attempt,"predecessor_receipt_hash":prior,"display_idempotency_key":f"display:{row.dispatch_id[:40]}","transport_acceptance":"not_applicable","outcome":"failed","failure_reason":"in_app_unavailable","observed_at":now+timedelta(seconds=(attempt-1)*5),"terminal":attempt==3}
            receipt=IncidentDeliveryReceipt(**receipt_body,receipt_hash=digest(receipt_body)); deliveries.append(receipt); prior=receipt.receipt_hash
        dead=1
    else:
        receipt_body={"row_hash":row.row_hash,"message_hash":message.message_hash,"attempt":1,"predecessor_receipt_hash":None,"display_idempotency_key":f"display:{row.dispatch_id[:40]}","transport_acceptance":"not_applicable","outcome":"displayed","failure_reason":"none","observed_at":now+timedelta(milliseconds=1),"terminal":True}
        receipt=IncidentDeliveryReceipt(**receipt_body,receipt_hash=digest(receipt_body)); deliveries.append(receipt); display_count=1
        if duplicate:
            duplicate_body={**receipt_body,"outcome":"duplicate_suppressed","predecessor_receipt_hash":receipt.receipt_hash}
            deliveries.append(IncidentDeliveryReceipt(**duplicate_body,receipt_hash=digest(duplicate_body)))
        outcome="stale_rejected" if stale_ack else "superseded" if superseded else "stale_rejected" if wrong_recipient else "accepted"
        ack_body={"row_hash":row.row_hash,"displayed_receipt_hash":receipt.receipt_hash,"audience_id":"audience:wrong" if wrong_recipient else audience.audience_id,"membership_revision":2 if stale_ack else 1,"session_revision":2 if stale_ack else 1,"acknowledgement_key":f"ack:{row.dispatch_id[:40]}","outcome":outcome,"acknowledged_at":now+timedelta(milliseconds=2),"incident_authority_effect":"none"}
        acks.append(IncidentAcknowledgementReceipt(**ack_body,receipt_hash=digest(ack_body)))
    outcome="dead_letter" if dead else "would_send"; body={"revision_hash":revision.revision_hash,"outbox_count":1,"displayed_count":display_count,"acknowledgement_count":sum(a.outcome=="accepted" for a in acks),"superseded_count":superseded_count,"dead_letter_count":dead,"external_attempts":0,"provider_cost":0,"incident_authority_effect":"none","outcome":outcome}
    decision=IncidentCommunicationBundleDecision(**body,decision_hash=digest(body))
    return {"_policy":item_policy,"_revision":revision,"_audiences":[audience],"_messages":[message],"_rows":[row],"_deliveries":deliveries,"_acks":acks,"_transitions":transitions,"_decision":decision,"baselineOutcome":"unavailable","candidateOutcome":outcome,"actualOutcome":outcome,"currentCount":1-superseded_count,"supersededCount":superseded_count,"deadLetterCount":dead,"displayCount":display_count,"acknowledgementCount":sum(a.outcome=="accepted" for a in acks),"authorityEffect":"none","externalAttempts":0,"providerCost":0,"decisionHash":decision.decision_hash,"policyHash":item_policy.policy_hash,"productOutcome":"unavailable","invariantVerdict":"pass"}
