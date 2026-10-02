from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from moeazi_agent.contracts import MarketSynthesis, Scenario, VisualizationPayload
from moeazi_agent.evaluation_contracts import (
    BudgetSpec, EvaluationSubject, ExperimentSpec, ForecastPoint, ModelTradeIntent,
    StrategySpec,
)
from moeazi_agent.evaluation_engine import (
    brier_score, deterministic_intent, estimate_experiment, simulate_entry,
    snapshot_hash, validate_grounding, empty_scorecard, update_scorecard,
)
from moeazi_agent.evaluation_scorecards import enrich_scorecards


def experiment(**changes):
    values = {
        "name": "BTC regime replay",
        "mode": "replay",
        "subjects": [
            EvaluationSubject(subject_id="champion", label="Champion", kind="champion"),
        ],
        "markets": ["BTC-USD"],
        "budget": BudgetSpec(
            maximum_per_run_microusd=100_000,
            maximum_daily_microusd=1_000_000,
            maximum_total_microusd=5_000_000,
        ),
        "confirmed_shadow_only": True,
    }
    values.update(changes)
    return ExperimentSpec(**values)


def synthesis(consensus=0.5, confidence=0.7):
    now = datetime.now(timezone.utc)
    scenarios = [
        Scenario(name="Up", probability=.4, triggers=[], invalidations=[], disclaimer="test"),
        Scenario(name="Flat", probability=.3, triggers=[], invalidations=[], disclaimer="test"),
        Scenario(name="Down", probability=.3, triggers=[], invalidations=[], disclaimer="test"),
    ]
    return MarketSynthesis(
        analysis_id="analysis", market="BTC-USD", tier="focus",
        consensus=consensus, confidence=confidence, disagreement=.2, freshness_ms=0,
        scenarios=scenarios, conflicts=[],
        visualization=VisualizationPayload(
            forces=[], story=[], scenarios=scenarios, agents=[], galaxy=[],
        ),
        created_at=now, valid_until=now + timedelta(minutes=5),
    )


def test_experiment_requires_one_champion_and_shadow_confirmation():
    with pytest.raises(ValidationError):
        experiment(confirmed_shadow_only=False)
    with pytest.raises(ValidationError):
        experiment(subjects=[
            EvaluationSubject(subject_id="c", label="Challenger", kind="challenger"),
        ])


def test_budget_order_is_fail_closed():
    with pytest.raises(ValidationError):
        BudgetSpec(
            maximum_per_run_microusd=10,
            maximum_daily_microusd=5,
            maximum_total_microusd=100,
        )


def test_snapshot_hash_is_stable_for_identical_frozen_inputs():
    left = snapshot_hash({"mark": 10}, [{"id": "e1", "content": "x"}])
    right = snapshot_hash({"mark": 10}, [{"id": "e1", "content": "x"}])
    assert left == right
    assert left != snapshot_hash({"mark": 11}, [{"id": "e1", "content": "x"}])


def test_grounding_flags_invented_citations_and_confidence_inflation():
    report = {
        "role": "technical_trend", "confidence": .95,
        "decision_summary": "BTC momentum is high",
        "evidence": [{"id": "made-up"}],
    }
    result = validate_grounding([report], {"real"}, "BTC-USD")
    assert result["citationValidityRate"] == 0
    assert {item["code"] for item in result["flags"]} == {
        "invented_citation", "confidence_inflation",
    }


def test_forecast_probabilities_and_brier_score():
    forecast = ForecastPoint(
        horizon="5m", probability_up=.8, probability_flat=.1,
        probability_down=.1, expected_return_bps=20, confidence=.8,
    )
    assert brier_score(forecast, "up") < brier_score(forecast, "down")
    with pytest.raises(ValidationError):
        ForecastPoint(
            horizon="5m", probability_up=.8, probability_flat=.8,
            probability_down=.1, expected_return_bps=20, confidence=.8,
        )


def test_strategy_is_shadow_only_and_accounts_for_costs():
    strategy = StrategySpec()
    intent = deterministic_intent(synthesis(), strategy)
    result = simulate_entry(intent, strategy, {
        "mark_price": 100, "taker_fee_bps": 5, "spread_bps": 4,
        "available_depth_usd": 100_000, "funding_rate_hourly": .0001,
    }, "deterministic")
    assert result["status"] == "open"
    assert result["shadowOnly"] is True
    assert result["entryPrice"] > 100
    assert result["feesUsd"] > 0


def test_model_directed_intent_is_clamped_by_strategy_envelope():
    strategy = StrategySpec(maximum_leverage=2, risk_fraction=.005)
    intent = ModelTradeIntent(
        action="short", horizon="1h", confidence=.9, leverage=20,
        risk_fraction=.05, decision_summary="test",
    )
    result = simulate_entry(intent, strategy, {"mark_price": 100}, "model_directed")
    assert result["leverage"] == 2
    assert result["notionalUsd"] == 100
    assert result["entryPrice"] < 100


def test_cost_preview_covers_every_subject_and_repetition():
    spec = experiment(subjects=[
        EvaluationSubject(subject_id="champion", label="Champion", kind="champion"),
        EvaluationSubject(subject_id="challenger", label="Challenger", kind="challenger"),
    ])
    estimate = estimate_experiment(spec, 3)
    assert len(estimate["subjects"]) == 2
    assert estimate["replayCases"] == 12
    assert estimate["adversarialCases"] == 6
    assert estimate["projectedReplayCostMicrousd"] > 0


def test_scorecard_tracks_repeatability_and_stance_flips_separately():
    card = empty_scorecard("experiment", "champion")
    first = update_scorecard(card, {
        "status": "completed", "output": {"synthesis": {"consensus": .5}},
        "validation": {}, "latency_ms": 10, "strategy_results": [],
    })
    second = update_scorecard(first, {
        "status": "completed", "output": {"synthesis": {"consensus": -.5}},
        "previousConsensus": .5, "validation": {}, "latency_ms": 10,
        "strategy_results": [],
    })
    assert second.repeatability_score == .5
    assert second.stance_flip_rate == 1


def test_scorecard_keeps_forecast_and_strategy_metrics_separate():
    rows = [{"subject_id": "champion", "scorecard": {}}]
    outcomes = [{
        "subject_id": "champion", "settled_at": datetime.now(timezone.utc),
        "brier_score": .1, "actual_direction": "up",
        "forecast": {
            "probability_up": .8, "probability_flat": .1, "probability_down": .1,
            "confidence": .8,
        },
    }]
    fills = [{
        "subject_id": "champion", "notional_usd": 100, "fees_usd": 1,
        "slippage_usd": 1, "funding_usd": 0, "pnl_usd": 8,
    }]
    card = enrich_scorecards(rows, outcomes, fills, 10_000)[0]["scorecard"]
    assert card["brier_score"] == .1
    assert card["forecast_accuracy"] == 1
    assert card["net_simulated_return_pct"] == .08
    assert card["win_rate"] == 1


def test_evaluation_runtime_has_no_execution_or_proposal_imports():
    root = Path("agent-service/src/moeazi_agent")
    sources = "\n".join(
        path.read_text()
        for path in [*root.glob("evaluation_*.py"), root / "forecast_model.py",
                     root / "grounding_evaluator.py", root / "strategy_model.py"]
    )
    for forbidden in (
        "execution_workflow", "proposal_routing", "recordTradeProposal",
        "execution_gateway", "execution_sidecar", "broadcast_transaction",
    ):
        assert forbidden not in sources
