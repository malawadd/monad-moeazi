import hashlib
import json
import math
from collections import Counter
from datetime import datetime, timedelta, timezone

from .costs import tier_estimate
from .evaluation_v2_contracts import EvaluationExperimentV2, SpendingLimits
from .model_routing import ModelRoute


DEFAULT_COSTS = {
    "specialist": (546, 756),
    "synthesis": (2_567, 4_698),
    "forecast": (834, 1_319),
    "model_strategy": (834, 1_319),
    "semantic_grounding": (834, 1_319),
}
STAGE_TOKENS = {
    "specialist": (2_500, 700, 4_000),
    "synthesis": (3_500, 1_200, 8_000),
    "forecast": (2_500, 500, 4_000),
    "model_strategy": (2_500, 500, 4_000),
    "semantic_grounding": (3_500, 500, 6_000),
}


def build_evaluation_plan(
    spec: EvaluationExperimentV2, global_daily_microusd: int,
    limits: SpendingLimits | None = None, start: datetime | None = None,
) -> dict:
    planned_start = (start or datetime.now(timezone.utc)).replace(second=0, microsecond=0)
    items = _plan_items(spec, planned_start)
    safety_count = sum(item["kind"] == "adversarial" for item in items)
    regular_count = len(items) - safety_count
    subject_rows = [_subject_cost(item, spec) for item in spec.subjects]
    expected_total = 0
    maximum_total = 0
    expected_calls = 0.0
    maximum_calls = 0
    max_per_observation = sum(item["maximumPerObservationMicrousd"] for item in subject_rows)
    for row in subject_rows:
        expected_total += (
            row["expectedBaseMicrousd"] * len(items)
            + row["expectedSemanticMicrousd"] * (
                safety_count + regular_count * spec.stages.semantic_sample_rate
            )
        )
        maximum_total += row["maximumPerObservationMicrousd"] * len(items)
        expected_calls += (
            row["baseCalls"] * len(items)
            + (safety_count + regular_count * spec.stages.semantic_sample_rate)
            * int(spec.stages.semantic_grounding)
        )
        maximum_calls += row["maximumCalls"] * len(items)
    per_day_observations = Counter(item["scheduledAt"][:10] for item in items)
    max_per_day = {
        day: count * max_per_observation for day, count in per_day_observations.items()
    }
    peak_day = max(max_per_day.values(), default=0)
    required = SpendingLimits(
        maximum_per_observation_microusd=max_per_observation,
        maximum_peak_day_microusd=peak_day,
        maximum_total_microusd=maximum_total,
    )
    issues = _issues(
        required, global_daily_microusd, limits, spec.preset_cost_cap_microusd,
    )
    public = {
        "schemaVersion": 2,
        "plannedStartAt": planned_start.isoformat(),
        "collectionEndAt": _collection_end(spec, planned_start),
        "observationCount": len(items),
        "replayObservationCount": sum(item["kind"] == "replay" for item in items),
        "adversarialObservationCount": safety_count,
        "liveObservationCount": sum(item["kind"] == "live_shadow" for item in items),
        "subjectRunCount": len(items) * len(spec.subjects),
        "expectedCalls": round(expected_calls, 2),
        "maximumCalls": maximum_calls,
        "expectedCostMicrousd": round(expected_total),
        "maximumCostMicrousd": maximum_total,
        "requiredLimits": required.model_dump(mode="json"),
        "globalDailyLimitMicrousd": global_daily_microusd,
        "dailyMaximums": max_per_day,
        "subjects": subject_rows,
        "phases": _phase_costs(items, subject_rows, spec),
        "issues": issues,
        "alternatives": _alternatives(spec, required, global_daily_microusd, issues),
        "assumptions": [
            "Expected tokens use the frozen stage estimator; actual usage settles after each call.",
            "Maximum cost assumes every selected output ceiling is reached.",
            "Semantic maximum assumes every observation is flagged; expected cost uses the sample rate plus all adversarial cases.",
            "No provider call is made while generating this preview.",
            *([f"Preset hard maximum is ${spec.preset_cost_cap_microusd / 1_000_000:.2f}."] 
              if spec.preset_cost_cap_microusd else []),
        ],
    }
    digest_payload = {"spec": spec.model_dump(mode="json"), "plan": public, "items": items}
    public["previewHash"] = hashlib.sha256(
        json.dumps(digest_payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()
    public["feasible"] = not issues
    return {**public, "_items": items}


def _plan_items(spec: EvaluationExperimentV2, start: datetime) -> list[dict]:
    items: list[dict] = []
    if spec.mode in {"replay", "replay_and_live_shadow"}:
        for case_id in spec.replay_case_ids:
            for repetition in range(1, spec.replay_repetitions + 1):
                items.append(_item("replay", start, case_id=case_id, repetition=repetition))
        for name in [*spec.safety_cases, *spec.custom_safety_case_ids]:
            items.append(_item("adversarial", start, case_id=name, repetition=1))
    if spec.mode in {"live_shadow", "replay_and_live_shadow"}:
        duration = int(spec.schedule.duration_minutes or 0)
        for market in spec.markets:
            cadence = spec.schedule.cadence_for(market)
            for offset in range(0, duration, cadence):
                items.append(_item(
                    "live_shadow", start + timedelta(minutes=offset),
                    market=market, repetition=1,
                ))
    return sorted(items, key=lambda item: (item["scheduledAt"], item["kind"], item["market"]))


def _item(
    kind: str, scheduled: datetime, case_id: str | None = None,
    market: str = "", repetition: int = 1,
) -> dict:
    identity = f"{kind}:{case_id or market}:{scheduled.isoformat()}:{repetition}"
    return {
        "planItemId": hashlib.sha256(identity.encode()).hexdigest()[:32],
        "kind": kind, "caseId": case_id, "market": market,
        "repetition": repetition, "scheduledAt": scheduled.isoformat(),
    }


def _subject_cost(subject, spec: EvaluationExperimentV2) -> dict:
    stages = ["synthesis"]
    if spec.stages.forecast:
        stages.append("forecast")
    if spec.stages.model_strategy:
        stages.append("model_strategy")
    if spec.stages.semantic_grounding:
        stages.append("semantic_grounding")
    expected_base = maximum_base = 0
    stage_rows = []
    for role in subject.selected_roles:
        route = subject.routing.route(f"role:{role}") if subject.routing else None
        expected, maximum, tokens = _call_cost("specialist", route)
        expected_base += expected
        maximum_base += maximum
        stage_rows.append(_stage_row(role, route, expected, maximum, tokens))
    semantic_expected = semantic_maximum = 0
    for stage in stages:
        route = subject.routing.route(
            "strategy" if stage == "model_strategy" else
            "grounding_evaluator" if stage == "semantic_grounding" else stage
        ) if subject.routing else None
        expected, maximum, tokens = _call_cost(stage, route)
        if stage == "semantic_grounding":
            semantic_expected, semantic_maximum = expected, maximum
        else:
            expected_base += expected
            maximum_base += maximum
        stage_rows.append(_stage_row(stage, route, expected, maximum, tokens))
    base_calls = len(subject.selected_roles) + len(stages) - int(spec.stages.semantic_grounding)
    return {
        "subjectId": subject.subject_id, "label": subject.label,
        "baseCalls": base_calls,
        "maximumCalls": base_calls + int(spec.stages.semantic_grounding),
        "expectedBaseMicrousd": expected_base,
        "expectedSemanticMicrousd": semantic_expected,
        "maximumPerObservationMicrousd": maximum_base + semantic_maximum,
        "stages": stage_rows,
    }


def _call_cost(stage: str, route: ModelRoute | None) -> tuple[int, int, dict]:
    expected_input, expected_output, maximum_input = STAGE_TOKENS[stage]
    if route is None:
        expected, maximum = DEFAULT_COSTS[stage]
        return expected, maximum, {
            "expectedInput": expected_input, "expectedOutput": expected_output,
            "maximumInput": maximum_input, "maximumOutput": (
                700 if stage == "specialist" else 1_200 if stage == "synthesis" else 500
            ),
            "method": "platform-stage-estimate",
        }
    expected_output = min(expected_output, route.max_output_tokens)
    expected = round((
        (route.input_price if route.estimated_input_price is None
         else route.estimated_input_price) * expected_input
        + (route.output_price if route.estimated_output_price is None
           else route.estimated_output_price) * expected_output
    ) / 1_000_000)
    maximum = round((
        route.input_price * maximum_input
        + route.output_price * route.max_output_tokens
    ) / 1_000_000)
    return expected, maximum, {
        "expectedInput": expected_input, "expectedOutput": expected_output,
        "maximumInput": maximum_input, "maximumOutput": route.max_output_tokens,
        "method": "frozen-route-price",
    }


def _stage_row(name, route, expected, maximum, tokens) -> dict:
    return {
        "stage": name, "provider": route.provider if route else "platform",
        "model": route.model if route else "platform-default",
        "credentialSource": route.credential_source if route else "platform",
        "expectedMicrousd": expected, "maximumMicrousd": maximum, "tokens": tokens,
    }


def _phase_costs(items: list[dict], subjects: list[dict], spec) -> list[dict]:
    rows = []
    for kind in ("replay", "adversarial", "live_shadow"):
        count = sum(item["kind"] == kind for item in items)
        expected = 0
        maximum = 0
        for subject in subjects:
            semantic_rate = 1 if kind == "adversarial" else spec.stages.semantic_sample_rate
            expected += count * (
                subject["expectedBaseMicrousd"]
                + subject["expectedSemanticMicrousd"] * semantic_rate
            )
            maximum += count * subject["maximumPerObservationMicrousd"]
        rows.append({
            "phase": kind, "observations": count,
            "expectedCostMicrousd": round(expected), "maximumCostMicrousd": maximum,
        })
    return rows


def _issues(required, global_daily: int, limits, preset_cap: int | None) -> list[dict]:
    issues = []
    checks = [
        ("global_daily", required.maximum_peak_day_microusd, global_daily),
    ]
    if preset_cap:
        checks.append(("preset_total", required.maximum_total_microusd, preset_cap))
    if limits:
        checks += [
            ("per_observation", required.maximum_per_observation_microusd,
             limits.maximum_per_observation_microusd),
            ("peak_day", required.maximum_peak_day_microusd,
             limits.maximum_peak_day_microusd),
            ("total", required.maximum_total_microusd, limits.maximum_total_microusd),
        ]
    for code, needed, available in checks:
        if needed > available:
            issues.append({
                "code": code, "severity": "blocking", "requiredMicrousd": needed,
                "availableMicrousd": available,
                "message": f"{code.replace('_', ' ').title()} requires more funded capacity.",
            })
    return issues


def _alternatives(spec, required, global_daily, issues) -> list[dict]:
    if not issues:
        return []
    ratio = min(1, global_daily / max(1, required.maximum_peak_day_microusd))
    duration = int(spec.schedule.duration_minutes or 0)
    market_count = len(spec.markets)
    return [
        {
            "code": "shorter_duration", "label": "Shorten live collection",
            "changes": {"durationMinutes": max(15, math.floor(duration * ratio / 15) * 15)},
        },
        {
            "code": "fewer_markets", "label": "Keep the highest-liquidity markets",
            "changes": {"marketCount": max(1, math.floor(market_count * ratio))},
        },
        {
            "code": "lower_frequency", "label": "Run observations less often",
            "changes": {"cadenceMultiplier": max(2, math.ceil(1 / max(ratio, .01)))},
        },
    ]


def _collection_end(spec, start: datetime) -> str | None:
    if spec.mode == "replay":
        return None
    return (start + timedelta(minutes=int(spec.schedule.duration_minutes or 0))).isoformat()
