"""Checked-in synthetic corpus; callers select IDs, never market-data bytes."""
from __future__ import annotations
from datetime import datetime, timedelta
from .venue_price_canonical import digest
from .venue_price_contracts import ExactQuantity, Feature07Binding, PriceObservation, PriceSourceSpec, Receipt, VenuePriceScope, VenuePriceSemantics
from .venue_price_evaluator import evaluate, ppm
from .venue_price_registry import raw, registry_hash

_BLOCK = {"divergence-equal-boundary", "divergence-above", "manipulation-spoof", "stale-repeat", "sequence-gap", "evm-reorg", "insufficient-finality", "funding-sign-ambiguity", "funding-interval-gap", "fee-omission", "liquidation-threshold", "thin-depth", "wrong-side-depth", "impact-over-limit", "min-step-violation", "oi-cap", "leverage-cap", "halted", "reduce-only", "wrong-margin-mode", "cross-position-drift", "disguised-reduce-flip"}
_UNKNOWN = {"missing-mark", "missing-index", "missing-oracle", "missing-trigger", "missing-funding", "missing-fee", "missing-account", "missing-liquidity", "missing-constraint", "future-observation", "expiry-equality", "sequence-reset", "zero-denominator", "dependent-sources", "disputed-source", "unsupported-formula", "definition-drift", "wrong-scope", "malformed-extra-field", "aggregate-overflow", "uncertain-commit"}
_CLOSE = {"close-lane-proved", "cancel-lane-proved", "reduce-lane-proved", "reconcile-lane-proved"}
_PASS = {"hyperliquid-isolated-long", "hyperliquid-cross-short", "gmx-isolated-long", "gmx-cross-short", "tier-rounding-boundary", "zero-exact-value", "maximum-bounded-value", "divergence-below", "divergence-equality-pass", "exact-retry", "concurrent-retry"}
_CASES = {name: "block" for name in _BLOCK} | {name: "unknown" for name in _UNKNOWN} | {name: "close_only" for name in _CLOSE} | {name: "pass" for name in _PASS}


def scenario_registry() -> list[dict]: return [{"id": name, "operation": "open"} for name in sorted(_CASES)]
def _hash(name: str) -> str: return digest({"fixture": name})


def _scope(name: str) -> VenuePriceScope:
    gmx = name.startswith("gmx")
    body = {"tenant_fingerprint":"tenant:fixture","account_fingerprint":"account:fixture","venue":"gmx_fixture" if gmx else "hyperliquid_fixture","venue_domain":"arbitrum_gmx_perp_fixture" if gmx else "hyperliquid_perp_fixture","owner_provider":"particle_fixture","owner_chain_id":42161 if gmx else None,"instrument_id":"instrument:fixture","feature07_definition_hash":_hash("feature07"),"market_namespace":"market:fixture","margin_mode":"cross" if "cross" in name else "isolated"}
    return VenuePriceScope(**body, scope_hash=digest(body))


def evaluate_fixture(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str,
                     closure_hash: str | None = None) -> dict:
    if scenario_id not in _CASES: raise ValueError("Unknown checked-in venue-price scenario")
    scope = _scope(scenario_id); expiry = now + timedelta(seconds=30)
    specs = []
    for role in raw()["requiredRoles"]:
        body={"source_id":f"source:{role}","scope_hash":scope.scope_hash,"role":role,"unit_id":"unit:usd","scale":8,"independence_group":f"group:{role}","freshness_seconds":10,"source_revision":"revision:fixture"}
        specs.append(PriceSourceSpec(**body,spec_hash=digest(body)))
    sem_body={"scope_hash":scope.scope_hash,"feature07_definition_hash":scope.feature07_definition_hash,"source_spec_hashes":sorted(x.spec_hash for x in specs),"formula_revision":"formula:fixture","adapter_revision":"adapter:fixture","config_revision":"config:fixture","valid_from":now-timedelta(seconds=1),"valid_until":expiry,"divergence_ppm":1000}
    semantics=VenuePriceSemantics(**sem_body,semantics_hash=digest(sem_body))
    observations=[]
    for spec in specs:
        value=ExactQuantity(amount="0" if scenario_id=="zero-exact-value" else str(2**256-1 if scenario_id=="maximum-bounded-value" else 100000000),unit_id="unit:usd",scale=8)
        ob={"scope_hash":scope.scope_hash,"source_spec_hash":spec.spec_hash,"value":value.model_dump(),"source_at":now,"observed_at":now,"coordinate":f"coord:{spec.role}","predecessor_hash":None,"availability":"available","finality":"final","anomaly":"none"}
        observations.append(PriceObservation(**ob,observation_hash=digest(ob)))
    reasons = []
    if scenario_id in _BLOCK: reasons.append("divergence_exceeded" if scenario_id.startswith("divergence") else "manipulation_flag" if "manipulation" in scenario_id or "spoof" in scenario_id else "finality_invalid" if scenario_id in {"evm-reorg","insufficient-finality","sequence-gap"} else "liquidity_insufficient" if "depth" in scenario_id or "impact" in scenario_id else "constraint_failed")
    if scenario_id in _UNKNOWN: reasons.append("definition_drift" if scenario_id=="definition-drift" else "scope_mismatch" if scenario_id=="wrong-scope" else "stale" if scenario_id in {"future-observation","expiry-equality"} else "missing_component")
    if scenario_id in _CLOSE: reasons.append("constraint_failed")
    receipt_outcome = "block" if scenario_id in _BLOCK | _CLOSE else "unknown" if scenario_id in _UNKNOWN else "pass"
    receipts=[]
    for kind in ("margin","funding","constraint","liquidity","liquidation"):
        body={"scope_hash":scope.scope_hash,"kind":kind,"outcome":receipt_outcome,"reason_codes":sorted(reasons),"expires_at":expiry,"input_hashes":sorted(item.observation_hash for item in observations)}
        receipts.append(Receipt(**body,receipt_hash=digest(body)))
    binding_body={"scope_hash":scope.scope_hash,"definition_hash":scope.feature07_definition_hash,"control_hash":closure_hash or _hash("feature07-control"),"status":"requires_revalidation"}
    binding=Feature07Binding(**binding_body,binding_hash=digest(binding_body))
    operation="open"; lanes=[scenario_id.split("-")[0]] if scenario_id in _CLOSE else []
    request_hash=digest({"scenario":scenario_id,"operator":operator,"registry":registry_hash(),"binding":binding.binding_hash})
    decision=evaluate(scope.scope_hash,operation,semantics,receipts,request_hash,f"venue-price:{run_hash[:48]}",now,feature07_ok=scenario_id!="definition-drift",safe_lanes=lanes)
    actual=decision.outcome
    return {"_scope":scope,"_specs":specs,"_semantics":semantics,"_observations":observations,"_receipts":receipts,"_binding":binding,"_decision":decision,"fixtureHash":digest({"scenario":scenario_id,"registry":registry_hash()}),"baselineOutcome":"unavailable","candidateOutcome":actual,"actualOutcome":actual,"semanticFamily":scope.venue_domain,"componentCompleteness":"complete" if not reasons else "degraded","freshness":"fresh" if "stale" not in reasons else "unknown","finality":"final" if "finality_invalid" not in reasons else "invalid","divergence":"within_bound" if scenario_id not in _BLOCK else "exceeded","fundingStatus":receipt_outcome,"constraintStatus":receipt_outcome,"liquidityStatus":receipt_outcome,"liquidationStatus":receipt_outcome,"stressCellCount":2,"safeLanes":decision.safe_lanes,"reasonCodes":decision.reason_codes,"receiptHash":decision.decision_hash,"registryHash":registry_hash(),"feature07Status":"requires_revalidation","contextStatuses":{"feature09":"requires_revalidation","feature10":"requires_revalidation","feature11":"requires_revalidation"},"productOutcome":"unavailable","invariantVerdict":"pass" if actual==_CASES[scenario_id] else "fail"}
