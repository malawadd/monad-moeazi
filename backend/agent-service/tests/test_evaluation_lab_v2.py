import inspect
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from moeazi_agent.evaluation_assets_api import _validate_asset
from moeazi_agent.evaluation_planner import build_evaluation_plan
from moeazi_agent.evaluation_reservations import reserve_complete_plan
from moeazi_agent.evaluation_v2_contracts import (
    EvaluationExperimentV2, EvaluationSchedule, EvaluationStageSelection,
    EvaluationSubjectV2, SpendingLimits,
)


ROLES = [
    "technical_trend", "liquidity", "derivatives", "on_chain", "news", "social",
]
SAFETY = [
    "missing_evidence", "stale_evidence", "contradiction",
    "prompt_injection", "wrong_market", "confidence_inflation",
]


def subject(**changes):
    values = {
        "subject_id": "champion", "label": "Champion", "kind": "champion",
        "tier": "focus", "selected_roles": ROLES, "quorum_minimum": 4,
        "prompt_bundle_id": "agent-v2",
    }
    values.update(changes)
    return EvaluationSubjectV2(**values)


def live_spec(**changes):
    values = {
        "name": "Finite BTC shadow", "mode": "live_shadow",
        "markets": ["BTC-USD"], "subjects": [subject()],
        "stages": EvaluationStageSelection(forecast=True),
        "horizons": ["5m", "1h"],
        "schedule": EvaluationSchedule(duration_minutes=60, cadence_minutes=15),
    }
    values.update(changes)
    return EvaluationExperimentV2(**values)


def screenshot_spec():
    markets = [f"M{i}" for i in range(362)]
    return EvaluationExperimentV2(
        name="Screenshot fixture", mode="replay_and_live_shadow",
        markets=markets, replay_case_ids=[f"case-{index}" for index in range(362)],
        subjects=[subject()], horizons=["5m", "1h", "4h", "24h"],
        stages=EvaluationStageSelection(
            forecast=True, model_strategy=True,
            semantic_grounding=True, semantic_sample_rate=.1,
        ),
        safety_cases=SAFETY, replay_repetitions=2,
        schedule=EvaluationSchedule(
            duration_minutes=1_440, cadence_minutes=60,
            market_cadence_minutes={market: 15 for market in markets[:20]},
        ),
    )


def test_v2_requires_explicit_finite_scope():
    with pytest.raises(ValidationError):
        live_spec(markets=[])
    with pytest.raises(ValidationError):
        live_spec(schedule=EvaluationSchedule(cadence_minutes=15))
    with pytest.raises(ValidationError):
        EvaluationExperimentV2(
            name="Replay", mode="replay", markets=["BTC-USD"],
            subjects=[subject()], stages=EvaluationStageSelection(),
            schedule=EvaluationSchedule(),
        )


def test_live_shadow_normalizes_irrelevant_zero_replay_repetitions():
    spec = live_spec(replay_repetitions=0)
    assert spec.replay_repetitions == 1
    with pytest.raises(ValidationError):
        EvaluationExperimentV2(
            name="Replay with invalid repetitions", mode="replay",
            markets=["ETH"], subjects=[subject()],
            stages=EvaluationStageSelection(),
            safety_cases=["prompt_injection"], replay_repetitions=0,
            schedule=EvaluationSchedule(),
        )


def test_screenshot_cost_fixture_is_exact_and_auditable():
    plan = build_evaluation_plan(
        screenshot_spec(), global_daily_microusd=999_999_999,
        start=datetime(2026, 7, 30, tzinfo=timezone.utc),
    )
    assert plan["liveObservationCount"] == 10_128
    assert plan["replayObservationCount"] == 724
    assert plan["adversarialObservationCount"] == 6
    assert plan["subjects"][0]["maximumPerObservationMicrousd"] == 13_191
    live = next(item for item in plan["phases"] if item["phase"] == "live_shadow")
    replay = sum(
        item["maximumCostMicrousd"] for item in plan["phases"]
        if item["phase"] in {"replay", "adversarial"}
    )
    assert live["maximumCostMicrousd"] == 133_598_448
    assert replay == 9_629_430


def test_expected_and_maximum_semantic_costs_are_separate():
    spec = live_spec(stages=EvaluationStageSelection(
        forecast=True, semantic_grounding=True, semantic_sample_rate=.1,
    ))
    plan = build_evaluation_plan(spec, 10_000_000)
    assert plan["expectedCostMicrousd"] < plan["maximumCostMicrousd"]
    assert plan["expectedCalls"] < plan["maximumCalls"]
    semantic = next(
        item for item in plan["subjects"][0]["stages"]
        if item["stage"] == "semantic_grounding"
    )
    assert semantic["maximumMicrousd"] > semantic["expectedMicrousd"]


def test_eth_guarded_preset_is_hard_capped_below_five_dollars():
    spec = live_spec(
        name="ETH 30-day guarded proving run", markets=["ETH-USD"],
        preset_id="eth-guarded-30d-v1", preset_cost_cap_microusd=5_000_000,
        subjects=[subject()], horizons=["5m", "1h", "4h", "24h"],
        stages=EvaluationStageSelection(
            forecast=True, deterministic_strategy=True, model_strategy=True,
            semantic_grounding=True, semantic_sample_rate=.1,
        ),
        schedule=EvaluationSchedule(duration_minutes=43_200, cadence_minutes=240),
    )
    plan = build_evaluation_plan(
        spec, 100_000, start=datetime(2026, 7, 30, tzinfo=timezone.utc),
    )
    assert plan["feasible"] is True
    assert plan["maximumCostMicrousd"] == 2_374_380
    assert plan["maximumCostMicrousd"] <= 5_000_000
    assert max(plan["dailyMaximums"].values()) == 79_146


def test_eth_guarded_preset_blocks_changes_that_break_its_cap():
    spec = live_spec(
        name="ETH over-scoped preset", markets=["ETH-USD"],
        preset_id="eth-guarded-30d-v1", preset_cost_cap_microusd=5_000_000,
        subjects=[subject()], horizons=["5m", "1h", "4h", "24h"],
        stages=EvaluationStageSelection(
            forecast=True, model_strategy=True, semantic_grounding=True,
            semantic_sample_rate=.1,
        ),
        schedule=EvaluationSchedule(duration_minutes=43_200, cadence_minutes=15),
    )
    plan = build_evaluation_plan(spec, 999_999_999)
    assert plan["feasible"] is False
    assert any(item["code"] == "preset_total" for item in plan["issues"])


def test_insufficient_global_capacity_is_red_with_explicit_alternatives():
    plan = build_evaluation_plan(live_spec(), global_daily_microusd=1)
    assert plan["feasible"] is False
    assert plan["issues"][0]["code"] == "global_daily"
    assert {item["code"] for item in plan["alternatives"]} == {
        "shorter_duration", "fewer_markets", "lower_frequency",
    }


def test_preview_is_pure_cost_math_and_makes_no_provider_call():
    source = inspect.getsource(build_evaluation_plan)
    assert "await " not in source
    assert "httpx" not in source
    assert "OpenAIProvider" not in source


class NoRedisCall:
    async def eval(self, *_args):
        raise AssertionError("Redis should not be reached for invalid limits")


@pytest.mark.asyncio
async def test_complete_plan_rejects_underfunded_limits_before_redis():
    limits = SpendingLimits(
        maximum_per_observation_microusd=1,
        maximum_peak_day_microusd=1,
        maximum_total_microusd=1,
    )
    with pytest.raises(RuntimeError, match="Per-observation"):
        await reserve_complete_plan(
            NoRedisCall(), "experiment", {"2026-07-30": 100},
            10, limits, 1_000, 172_800,
        )


def test_prompt_schema_must_keep_scoring_fields():
    with pytest.raises(HTTPException, match="incompatible"):
        _validate_asset("prompt_bundle", {
            "prompts": {"technical_trend": {"system": "x", "user": "y"}},
            "schemas": {
                "signal_report": {"properties": {"score": {}}},
                "synthesis": {"properties": {}},
            },
        }, freezing=True)


def test_v2_sources_keep_execution_boundary_closed():
    modules = (
        "evaluation_v2_temporal", "evaluation_pipeline_v2",
        "evaluation_pipeline_stages", "evaluation_v2_api",
    )
    sources = "\n".join(
        __import__(f"moeazi_agent.{name}", fromlist=["x"]).__loader__
        .get_source(f"moeazi_agent.{name}") for name in modules
    )
    for forbidden in (
        "execution_workflow", "proposal_routing", "recordTradeProposal",
        "execution_gateway", "execution_sidecar", "broadcast_transaction",
    ):
        assert forbidden not in sources
