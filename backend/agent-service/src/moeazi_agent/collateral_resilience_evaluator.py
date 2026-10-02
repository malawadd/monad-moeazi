"""Integer-only, fail-closed evaluator for local collateral resilience fixtures."""
from __future__ import annotations
from datetime import datetime, timedelta
from .collateral_resilience_canonical import digest
from .collateral_resilience_contracts import (CollateralBalanceObservation, CollateralRiskEnvelope,
    DependencyObservation, ExitLiquidityObservation, FundingBorrowObservation, PositionExposureObservation)
from .collateral_resilience_registry import raw

BPS = 10_000

def floor_div(numerator: int, denominator: int) -> int:
    if denominator <= 0: raise ValueError("zero denominator")
    return numerator // denominator

def stressed_value(balance: CollateralBalanceObservation, price: int, decimals: int, haircuts_bps: list[int]) -> tuple[int, int, int]:
    """Return gross, bounded haircut and usable value using exact whole integers."""
    if decimals < 0 or price < 0 or any(item < 0 for item in haircuts_bps): raise ValueError("invalid stress input")
    gross = floor_div(balance.free.value() * price, 10 ** decimals)
    haircut = min(BPS, sum(haircuts_bps))
    return gross, haircut, floor_div(gross * (BPS - haircut), BPS)

def shock_loss(position: PositionExposureObservation, stressed_mark: int) -> int:
    mark = position.mark.value(); size = position.size.value()
    if mark <= 0 or stressed_mark < 0: raise ValueError("invalid mark")
    delta = mark - stressed_mark if position.side == "long" else stressed_mark - mark
    return max(0, size * delta // mark)

def _outcome(operation: str, reasons: set[str], lanes: list[str]) -> str:
    known = {"capacity_inadequate", "dependency_halted", "liquidity_unsafe", "stress_deficit"}
    if not reasons: return "pass"
    if operation in raw()["increaseOperations"] and lanes: return "close_only"
    return "block" if reasons & known else "unknown"

def evaluate(scope_hash: str, operation: str, balance: CollateralBalanceObservation,
             position: PositionExposureObservation, funding: FundingBorrowObservation,
             dependencies: list[DependencyObservation], liquidity: ExitLiquidityObservation,
             request_hash: str, now: datetime, *, price: int, decimals: int,
             haircut_bps: list[int], reserve: int, safe_lanes: list[str]) -> CollateralRiskEnvelope:
    registry = raw(); reasons: set[str] = set()
    if operation not in registry["operations"]: reasons.add("unsupported_operation")
    evidence = [balance, position, funding, liquidity, *dependencies]
    if any(item.expires_at <= now for item in evidence): reasons.add("evidence_stale")
    if any(getattr(item, "observed_at", now) > now for item in evidence): reasons.add("finality_unknown")
    if any(item.state in {"halted", "degraded"} for item in dependencies): reasons.add("dependency_halted")
    if any(item.state in {"unknown", "disputed"} for item in dependencies) or liquidity.state in {"missing", "disputed", "nonfinal"}: reasons.add("evidence_missing")
    if liquidity.impact_bps > liquidity.maximum_impact_bps or liquidity.capacity.value() < liquidity.requested.value(): reasons.add("liquidity_unsafe")
    try:
        _, _, usable = stressed_value(balance, price, decimals, haircut_bps)
        required = position.maintenance.value() + shock_loss(position, price * (BPS - min(BPS, sum(haircut_bps))) // BPS)
        required += sum(item.value() for item in (funding.payable, funding.borrow_principal, funding.accrued_borrow, funding.close_fee, funding.settlement_fee)) + reserve
        surplus = usable - required
        if surplus < 0: reasons.add("stress_deficit")
        exit_capacity = min(liquidity.capacity.value(), balance.withdrawable_now.value())
        if exit_capacity < liquidity.requested.value(): reasons.add("capacity_inadequate")
    except ValueError:
        usable, required, surplus, exit_capacity = 0, 0, 0, 0; reasons.add("evidence_missing")
    lanes = sorted(set(safe_lanes) & set(registry["safeLanes"])) if operation in registry["increaseOperations"] else []
    outcome = _outcome(operation, reasons, lanes)
    if outcome != "close_only": lanes = []
    max_increase = max(0, min(max(0, surplus), max(0, exit_capacity - liquidity.requested.value())))
    receipts = sorted([balance.observation_hash, position.observation_hash, funding.observation_hash, liquidity.observation_hash,
        *(item.observation_hash for item in dependencies)])
    body = {"scope_hash": scope_hash, "operation": operation, "outcome": outcome, "reason_codes": sorted(reasons),
        "safe_lanes": lanes, "stressed_surplus": str(surplus), "exit_capacity": str(exit_capacity), "maximum_increase": str(max_increase),
        "receipt_hashes": receipts, "expires_at": min(item.expires_at for item in evidence), "request_hash": request_hash}
    return CollateralRiskEnvelope(**body, envelope_hash=digest(body))
