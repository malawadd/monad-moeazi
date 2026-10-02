import hashlib
import json
import math
from datetime import datetime, timezone
from typing import Any

from .evaluation_contracts import (
    EvaluationScorecard, ExperimentSpec, ForecastPoint, ModelTradeIntent, StrategySpec,
)
from .model_routing import ModelRouting, route_estimate
from .roles import assignments_for_tier
from .costs import tier_estimate


HORIZON_SECONDS = {"5m": 300, "1h": 3_600, "4h": 14_400, "24h": 86_400}


def snapshot_hash(market_snapshot: dict, evidence: list[dict]) -> str:
    payload = json.dumps(
        {"market": market_snapshot, "evidence": evidence},
        sort_keys=True, separators=(",", ":"), default=str,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def estimate_experiment(spec: ExperimentSpec, market_count: int) -> dict:
    subject_rows = []
    per_observation = 0
    for subject in spec.subjects:
        routing = subject.routing
        estimate = route_estimate(subject.tier, assignments_for_tier(subject.tier), routing)
        fallback = tier_estimate(subject.tier)
        extra_slots = []
        extra_slots.append("forecast")
        if "model_directed" in spec.strategy_modes:
            extra_slots.append("strategy")
        if spec.semantic_sample_rate > 0:
            extra_slots.append("grounding_evaluator")
        maximum = (
            routing_cost_ceiling(subject.tier, routing, extra_slots) if routing
            else round(
                float(fallback["maximumCostUsd"]) * 1_000_000
                * (fallback["totalCalls"] + len(extra_slots)) / fallback["totalCalls"]
            )
        )
        calls = len(assignments_for_tier(subject.tier)) + len(extra_slots) + {
            "focus": 1, "pro": 2, "max": 3,
        }[subject.tier]
        per_observation += maximum
        subject_rows.append({
            "subjectId": subject.subject_id, "calls": calls,
            "maximumCostMicrousd": maximum,
            "estimatedCostMicrousd": (
                int(estimate.get("estimated_provider_cost_microusd", maximum))
                if routing else int(fallback["estimatedCostMicrousd"])
            ),
        })
    adversarial_cases = (
        6 if spec.mode in {"replay", "replay_and_live_shadow"} else 0
    )
    replay_cases = (
        market_count * spec.replay_repetitions + adversarial_cases
        if spec.mode in {"replay", "replay_and_live_shadow"} else 0
    )
    high = min(20, market_count)
    daily_live_cases = (
        high * 96 + max(0, market_count - high) * 24
        if spec.mode in {"live_shadow", "replay_and_live_shadow"} else 0
    )
    return {
        "subjects": subject_rows,
        "marketCount": market_count,
        "replayCases": replay_cases,
        "adversarialCases": adversarial_cases,
        "projectedDailyLiveCases": daily_live_cases,
        "maximumPerObservationMicrousd": per_observation,
        "projectedReplayCostMicrousd": per_observation * replay_cases,
        "projectedDailyCostMicrousd": per_observation * daily_live_cases,
    }


def routing_cost_ceiling(
    tier: str, routing: ModelRouting, extra_slots: list[str] | None = None,
) -> int:
    specialist_slots = [f"role:{item.role.name}" for item in assignments_for_tier(tier)]
    synthesis_slots = {
        "focus": ["synthesis"], "pro": ["critic", "synthesis"],
        "max": ["synthesis_primary", "synthesis_challenger", "arbiter"],
    }[tier]
    return sum(
        round((route.input_price * 4_000 + route.output_price * route.max_output_tokens) / 1_000_000)
        for route in [
            routing.route(slot)
            for slot in specialist_slots + synthesis_slots + (extra_slots or [])
        ]
    )


def actual_routing_cost(routing: ModelRouting | None, calls: list[dict]) -> int:
    if not routing:
        return sum(int(item.get("provider_cost_microusd", 0)) for item in calls)
    total = 0
    for call in calls:
        slot = (
            call.get("role", "synthesis")
            if call.get("kind") == "synthesis"
            else f"role:{call.get('role', '')}"
        )
        route = routing.route(slot)
        input_tokens = max(0, int(call.get("input_tokens", 0)))
        cached = min(input_tokens, max(0, int(call.get("cached_input_tokens", 0))))
        output = max(0, int(call.get("output_tokens", 0)))
        reported = call.get("provider_cost_microusd")
        if call.get("cost_source") == "provider_reported" and reported is not None:
            total += max(0, int(reported))
        else:
            total += round((
                (input_tokens - cached) * route.input_price
                + cached * route.cached_input_price + output * route.output_price
            ) / 1_000_000)
    return total


def validate_grounding(reports: list[Any], evidence_ids: set[str], market: str) -> dict:
    flags: list[dict] = []
    citations = 0
    valid = 0
    for report in reports:
        dumped = report.model_dump(mode="json") if hasattr(report, "model_dump") else report
        report_ids = [
            item.get("id") for item in dumped.get("evidence", []) if item.get("id")
        ]
        citations += len(report_ids)
        valid += sum(identifier in evidence_ids for identifier in report_ids)
        invented = sorted(set(report_ids) - evidence_ids)
        if invented:
            flags.append({
                "code": "invented_citation", "role": dumped.get("role"),
                "detail": ",".join(invented),
            })
        summary = str(dumped.get("decision_summary", ""))
        if market.split("-")[0].lower() not in summary.lower() and not report_ids:
            flags.append({
                "code": "ungrounded_market_claim", "role": dumped.get("role"),
                "detail": "No market reference or evidence citation",
            })
        confidence = float(dumped.get("confidence", 0))
        if confidence > 0.85 and len(report_ids) < 2:
            flags.append({
                "code": "confidence_inflation", "role": dumped.get("role"),
                "detail": f"{confidence:.2f} confidence with fewer than two citations",
            })
    return {
        "flags": flags, "citationCount": citations, "validCitationCount": valid,
        "citationValidityRate": valid / citations if citations else 0,
        "semanticGrounding": "pending_sample" if flags else "not_sampled",
    }


def forecasts_from_synthesis(synthesis: Any) -> list[ForecastPoint]:
    consensus = float(synthesis.consensus)
    confidence = float(synthesis.confidence)
    flat = max(0.08, 0.36 - abs(consensus) * 0.2)
    directional = 1 - flat
    up = directional * (0.5 + consensus * 0.35)
    down = 1 - flat - up
    return [
        ForecastPoint(
            horizon=horizon, probability_up=up, probability_flat=flat,
            probability_down=down, expected_return_bps=consensus * scale,
            confidence=confidence, invalidations=list(synthesis.conflicts[:4]),
        )
        for horizon, scale in (("5m", 20), ("1h", 60), ("4h", 140), ("24h", 300))
    ]


def brier_score(forecast: ForecastPoint, actual: str) -> float:
    actuals = {
        "up": (1, 0, 0), "flat": (0, 1, 0), "down": (0, 0, 1),
    }[actual]
    predicted = (
        forecast.probability_up, forecast.probability_flat, forecast.probability_down,
    )
    return sum((p - a) ** 2 for p, a in zip(predicted, actuals)) / 3


def deterministic_intent(synthesis: Any, strategy: StrategySpec) -> ModelTradeIntent:
    if (
        abs(float(synthesis.consensus)) < strategy.entry_consensus
        or float(synthesis.confidence) < strategy.minimum_confidence
    ):
        return ModelTradeIntent(
            action="abstain", horizon="24h", confidence=float(synthesis.confidence),
            decision_summary="The deterministic entry thresholds were not met.",
        )
    return ModelTradeIntent(
        action="long" if synthesis.consensus > 0 else "short",
        horizon="24h", confidence=float(synthesis.confidence),
        risk_fraction=strategy.risk_fraction, leverage=strategy.maximum_leverage,
        stop_loss_pct=strategy.stop_loss_pct,
        take_profit_pct=strategy.take_profit_pct,
        max_hold_seconds=strategy.maximum_hold_seconds,
        decision_summary="The versioned consensus and confidence thresholds passed.",
    )


def simulate_entry(
    intent: ModelTradeIntent, strategy: StrategySpec, market_snapshot: dict,
    strategy_mode: str,
) -> dict:
    if intent.action == "abstain":
        return {"mode": strategy_mode, "status": "abstained", "reason": intent.decision_summary}
    price = float(market_snapshot.get("mark_price") or 0)
    if price <= 0:
        return {"mode": strategy_mode, "status": "rejected", "reason": "No trustworthy mark price"}
    leverage = min(intent.leverage, strategy.maximum_leverage)
    notional = strategy.starting_equity_usd * min(intent.risk_fraction, strategy.risk_fraction) * leverage
    fee_bps = float(market_snapshot.get("taker_fee_bps") or 6)
    spread_bps = float(market_snapshot.get("spread_bps") or 4)
    depth = float(market_snapshot.get("available_depth_usd") or max(notional, 1))
    depth_slippage_bps = min(100, notional / max(depth, 1) * 10)
    slippage_bps = spread_bps / 2 + depth_slippage_bps
    entry_price = price * (
        1 + slippage_bps / 10_000 if intent.action == "long"
        else 1 - slippage_bps / 10_000
    )
    return {
        "mode": strategy_mode, "status": "open", "shadowOnly": True,
        "side": intent.action, "notionalUsd": round(notional, 2), "leverage": leverage,
        "markPrice": price, "entryPrice": entry_price,
        "feesUsd": notional * fee_bps / 10_000,
        "slippageUsd": notional * slippage_bps / 10_000,
        "fundingRateHourly": float(market_snapshot.get("funding_rate_hourly") or 0),
        "stopLossPct": intent.stop_loss_pct, "takeProfitPct": intent.take_profit_pct,
        "maximumHoldSeconds": min(intent.max_hold_seconds, strategy.maximum_hold_seconds),
    }


def empty_scorecard(experiment_id: str, subject_id: str) -> EvaluationScorecard:
    return EvaluationScorecard(
        experiment_id=experiment_id, subject_id=subject_id,
        updated_at=datetime.now(timezone.utc),
    )


def update_scorecard(card: EvaluationScorecard, run: dict) -> EvaluationScorecard:
    prior_runs = card.run_count
    total = prior_runs + 1
    validation = run.get("validation", {})
    current = (run.get("output", {}).get("synthesis") or {}).get("consensus")
    previous = run.get("previousConsensus")
    repeatability = None if current is None or previous is None else max(
        0, 1 - abs(float(current) - float(previous)) / 2,
    )
    flipped = (
        1 if current is not None and previous is not None
        and abs(float(current)) >= .12 and abs(float(previous)) >= .12
        and (float(current) > 0) != (float(previous) > 0) else 0
    )
    return card.model_copy(update={
        "run_count": total,
        "schema_success_rate": (
            card.schema_success_rate * prior_runs + (1 if run["status"] == "completed" else 0)
        ) / total,
        "citation_validity_rate": (
            card.citation_validity_rate * prior_runs
            + float(validation.get("citationValidityRate", 0))
        ) / total,
        "grounding_flags": card.grounding_flags + len(validation.get("flags", [])),
        "repeatability_score": (
            card.repeatability_score if repeatability is None
            else ((card.repeatability_score or 0) * max(0, prior_runs - 1) + repeatability)
            / max(1, prior_runs)
        ),
        "stance_flip_rate": (
            card.stance_flip_rate * max(0, prior_runs - 1) + flipped
        ) / max(1, prior_runs),
        "mean_latency_ms": (
            card.mean_latency_ms * prior_runs + int(run.get("latency_ms", 0))
        ) / total,
        "input_tokens": card.input_tokens + int(run.get("input_tokens", 0)),
        "output_tokens": card.output_tokens + int(run.get("output_tokens", 0)),
        "provider_cost_microusd": (
            card.provider_cost_microusd + int(run.get("provider_cost_microusd", 0))
        ),
        "simulated_fills": card.simulated_fills + sum(
            item.get("status") == "open" for item in run.get("strategy_results", [])
        ),
        "rejected_intents": card.rejected_intents + sum(
            item.get("status") == "rejected" for item in run.get("strategy_results", [])
        ),
        "updated_at": datetime.now(timezone.utc),
    })
