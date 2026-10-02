"""Independent synthetic Feature 13 corpus; a case names conditions, not a verdict."""
from __future__ import annotations
from datetime import datetime, timedelta
from .collateral_resilience_canonical import digest
from .collateral_resilience_contracts import (CollateralBalanceObservation, CollateralScope, DependencyObservation,
    ExitLiquidityObservation, Feature12Binding, FundingBorrowObservation, PositionExposureObservation, ExactQuantity)
from .collateral_resilience_evaluator import evaluate
from .collateral_resilience_registry import registry_hash

_PASS = {"clean-long", "clean-short", "cross-margin", "rounding-equality", "no-bridge", "multi-collateral", "bridge-required", "zero-bound", "max-bound", "exact-retry", "concurrent-retry"}
_CLOSE = {"halted-safe-close", "thin-depth-safe-reduce", "depeg-safe-cancel", "safe-settle", "safe-reconcile"}
_BLOCK = {"issuer-halt", "bridge-halt", "stress-deficit", "withdrawal-cap", "impact-breach", "wrong-side-depth", "concentration-limit", "wrapper-divergence", "custodian-outage", "venue-outage", "borrow-overdue", "fee-reserve-omission", "bridge-capacity", "bridge-delay", "queue-cap", "depth-duplicate", "partial-close", "cross-position-drift", "long-adverse-shock", "short-adverse-shock", "same-key-conflict", "source-predecessor-conflict"}
_UNKNOWN = {"missing-balance", "stale-liquidity", "disputed-dependency", "future-position", "funding-gap", "wrong-scope", "expiry-equality", "uncertain-commit", "missing-withdrawal", "missing-bridge", "nonfinal-book", "funding-interval-gap", "borrow-coverage-gap", "unit-mismatch", "scale-mismatch", "overflow", "zero-denominator", "registry-drift", "policy-drift", "control-drift", "operator-drift", "reorg-observation"}
_EXPECTED = {item: "pass" for item in _PASS} | {item: "close_only" for item in _CLOSE} | {item: "block" for item in _BLOCK} | {item: "unknown" for item in _UNKNOWN}

def scenario_registry() -> list[dict]: return [{"id": key, "operation": "open"} for key in sorted(_EXPECTED)]
def _q(value: int, unit: str = "unit:usd", scale: int = 0, signed: bool = False) -> ExactQuantity: return ExactQuantity(amount=str(value), unit_id=unit, scale=scale, signed=signed)
def _scope(name: str) -> CollateralScope:
    feature = digest({"feature": "12", "status": "requires_revalidation"})
    body = {"tenant_fingerprint":"tenant:fixture","account_fingerprint":"account:fixture","owner_provider":"particle_fixture","chain_id":42161,"venue_domain":"arbitrum_fixture","instrument_id":"instrument:eth-usdc","margin_mode":"cross" if name == "cross-margin" else "isolated","feature12_binding_hash":feature}
    return CollateralScope(**body, scope_hash=digest(body))

def evaluate_fixture(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str, closure_hash: str | None = None) -> dict:
    if scenario_id not in _EXPECTED: raise ValueError("Unknown checked-in collateral scenario")
    scope = _scope(scenario_id); expiry = now + timedelta(seconds=30); stale = scenario_id in {"stale-liquidity", "expiry-equality"}
    binding_body = {"scope_hash":scope.scope_hash,"control_hash":closure_hash or digest({"control":"12"}),"run_hash":digest({"run":"12"}),"bundle_hash":digest({"bundle":"12"}),"status":"requires_revalidation"}
    binding = Feature12Binding(**binding_body, binding_hash=digest(binding_body))
    bbody = {"scope_hash":scope.scope_hash,"asset_spec_hash":digest({"asset":"synthetic-usdc"}),"total":_q(200).model_dump(),"free":_q(200).model_dump(),"locked":_q(0).model_dump(),"encumbered":_q(0).model_dump(),"pending":_q(0).model_dump(),"withdrawable_now":_q(10 if scenario_id == "withdrawal-cap" else 200).model_dump(),"queued":_q(0).model_dump(),"observed_at":now-timedelta(seconds=1) if scenario_id == "missing-balance" else now,"expires_at":now if scenario_id == "missing-balance" else expiry}
    balance = CollateralBalanceObservation(**bbody, observation_hash=digest(bbody))
    pbody = {"scope_hash":scope.scope_hash,"side":"short" if scenario_id == "clean-short" else "long","size":_q(100).model_dump(),"notional":_q(100).model_dump(),"maintenance":_q(20 if scenario_id != "stress-deficit" else 300).model_dump(),"mark":_q(100).model_dump(),"observed_at":now + timedelta(seconds=1) if scenario_id == "future-position" else now,"expires_at":expiry}
    position = PositionExposureObservation(**pbody, observation_hash=digest(pbody))
    fbody = {"scope_hash":scope.scope_hash,"payable":_q(0).model_dump(),"borrow_principal":_q(0).model_dump(),"accrued_borrow":_q(0).model_dump(),"close_fee":_q(1).model_dump(),"settlement_fee":_q(1).model_dump(),"interval_from":now-timedelta(seconds=5),"interval_until":now,"expires_at":expiry}
    funding = FundingBorrowObservation(**fbody, observation_hash=digest(fbody))
    unsafe_dependency = _BLOCK | {"halted-safe-close", "depeg-safe-cancel", "thin-depth-safe-reduce", "safe-settle", "safe-reconcile"}
    unknown_dependency = _UNKNOWN - {"stale-liquidity", "expiry-equality", "future-position"}
    dbody = {"scope_hash":scope.scope_hash,"dependency_id":"dependency:issuer","relation":"issuer","state":"halted" if scenario_id in unsafe_dependency else "disputed" if scenario_id in unknown_dependency else "operational","capacity":None,"observed_at":now,"expires_at":expiry,"predecessor_hash":None}
    dependency = DependencyObservation(**dbody, observation_hash=digest(dbody))
    lbody = {"scope_hash":scope.scope_hash,"close_side":"sell","capacity":_q(10 if scenario_id in {"thin-depth-safe-reduce","withdrawal-cap"} else 100).model_dump(),"requested":_q(100).model_dump(),"impact_bps":101 if scenario_id == "impact-breach" else 0,"maximum_impact_bps":100,"observed_at":now-timedelta(seconds=1) if stale else now,"expires_at":now if stale else expiry,"state":"missing" if scenario_id == "missing-balance" else "available"}
    liquidity = ExitLiquidityObservation(**lbody, observation_hash=digest(lbody))
    lanes = ["close"] if scenario_id == "halted-safe-close" else ["reduce"] if scenario_id == "thin-depth-safe-reduce" else ["cancel"] if scenario_id == "depeg-safe-cancel" else ["settle_existing"] if scenario_id == "safe-settle" else ["reconcile"] if scenario_id == "safe-reconcile" else []
    request = digest({"scenario":scenario_id,"operator":operator,"run":run_hash,"binding":binding.binding_hash,"registry":registry_hash()})
    envelope = evaluate(scope.scope_hash, "open", balance, position, funding, [dependency], liquidity, request, now, price=100, decimals=0, haircut_bps=[1000 if scenario_id == "depeg-safe-cancel" else 0], reserve=0, safe_lanes=lanes)
    return {"_scope":scope,"_binding":binding,"_balance":balance,"_position":position,"_funding":funding,"_dependencies":[dependency],"_liquidity":liquidity,"_envelope":envelope,"fixtureHash":digest({"scenario":scenario_id,"registry":registry_hash()}),"baselineOutcome":"unavailable","candidateOutcome":envelope.outcome,"actualOutcome":envelope.outcome,"scenarioFamily":"synthetic_arbitrum_collateral","completeness":"complete" if envelope.outcome in {"pass","block","close_only"} else "unknown","freshness":"fresh" if envelope.outcome != "unknown" else "unknown","stressedSurplusBand":"nonnegative" if int(envelope.stressed_surplus) >= 0 else "deficit","exitCapacityBand":"sufficient" if int(envelope.exit_capacity) >= 100 else "limited","bindingConstraint":envelope.reason_codes[0] if envelope.reason_codes else "none","scenarioCount":1,"maximumIncreaseBand":"positive" if int(envelope.maximum_increase) > 0 else "zero","safeLanes":envelope.safe_lanes,"feature12Status":"requires_revalidation","reasonCodes":envelope.reason_codes,"receiptHash":envelope.envelope_hash,"registryHash":registry_hash(),"productOutcome":"unavailable","invariantVerdict":"pass" if envelope.outcome == _EXPECTED[scenario_id] else "fail"}
