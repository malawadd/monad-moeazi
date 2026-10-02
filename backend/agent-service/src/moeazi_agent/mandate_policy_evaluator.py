"""In-memory reference evaluator: one-use consent, head recheck and inert receipt."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from .mandate_policy_canonical import digest

class MandatePolicyState:
    def __init__(self): self.head=None; self.used:set[str]=set(); self.claims:dict[str,dict]={}; self.inflight:set[str]=set()

def issue_challenge(scope_hash: str, compilation, diff: dict, prior_hash: str | None, now: datetime, idempotency_hash: str, identity: dict | None = None, request_hash: str | None = None) -> dict:
    if diff["aggregate"] in {"unknown","no_change"}: raise ValueError("unconfirmable_diff")
    kind="standard" if diff["aggregate"]=="tightening_only" else "material_change"
    who=identity or {"tenant":"tenant:fixture","user":"user:fixture","account":"account:fixture","confirmer":"user:fixture"}
    receipt=compilation.receipt; binding={"scope":scope_hash,"tenant":who["tenant"],"user":who["user"],"account":who["account"],"confirmer":who["confirmer"],"mandate":receipt["mandateHash"],"predecessor":receipt.get("predecessorHash"),"prior":prior_hash,"policy":receipt["policyHash"],"profile":receipt["bindingHash"],"map":receipt["mapHash"],"coverage":receipt["coverageHash"],"test":receipt["testHash"],"compiler":receipt["compilerVersion"],"schema":receipt["schemaVersion"],"registry":receipt["registryHash"],"diff":diff["diffHash"],"request":request_hash or idempotency_hash,"idempotency":idempotency_hash}
    nonce=digest({"binding":binding,"issued":now.isoformat()})
    return {"nonceHash":nonce,"bindingHash":digest(binding),"issuedAt":now,"expiresAt":now+timedelta(minutes=10),"kind":kind,"useCount":0,"_binding":binding}

def consume_and_activate(state: MandatePolicyState, challenge: dict, compilation, diff: dict, now: datetime, mode: str, idempotency_key: str, scope_hash: str = "scope:fixture", identity: dict | None = None, outcome: str = "confirmed", request_hash: str | None = None) -> dict:
    if mode not in {"observe","enforce"}: raise ValueError("mode_blocked")
    if mode=="observe": return {"consent":None,"activation":None,"boundary":None,"currentHead":state.head,"result":"not_applied_observe"}
    if challenge["nonceHash"] in state.used or now > challenge["expiresAt"] or now.tzinfo is None: raise ValueError("challenge_replayed_or_expired")
    if outcome!="confirmed": raise ValueError("consent_declined")
    prior=state.head["activationHash"] if state.head else None
    expected=issue_challenge(scope_hash,compilation,diff,prior,challenge["issuedAt"],digest({"idempotency":idempotency_key}),identity,request_hash or digest({"idempotency":idempotency_key}))
    if expected["bindingHash"] != challenge["bindingHash"]: raise ValueError("stale_current_head_or_hash")
    if challenge["nonceHash"] in state.inflight: raise ValueError("concurrent_activation")
    state.inflight.add(challenge["nonceHash"]); state.used.add(challenge["nonceHash"])
    consent={"challengeNonceHash":challenge["nonceHash"],"bindingHash":challenge["bindingHash"],"consentHash":digest({"binding":challenge["bindingHash"],"outcome":outcome}),"outcome":"confirmed","useCount":1}
    activation={"predecessorHash":prior,"sequence":1 if not state.head else state.head["sequence"]+1,"result":"simulated_activated","activatedAt":now}
    activation["activationHash"]=digest({**activation,"consent":consent["consentHash"],"policy":compilation.receipt["policyHash"]})
    state.head=activation; state.inflight.remove(challenge["nonceHash"])
    history_hash=digest({"activation":activation["activationHash"],"sequence":activation["sequence"]})
    boundary={"activationHash":activation["activationHash"],"historyAppendHash":history_hash,"nonAuthorizing":True,"acceptedForProduct":False,"productStatus":"unavailable","effectiveAuthorityStatus":"unavailable","authorityEffect":"none"}
    boundary["boundaryHash"]=digest(boundary)
    return {"consent":consent,"activation":activation,"boundary":boundary,"currentHead":state.head}
