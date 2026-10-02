from datetime import timedelta

import pytest
from pydantic import ValidationError

from moeazi_agent.contracts import AgentRunView, Scenario, SignalReport, utc_now
from moeazi_agent.synthesis import synthesize


def report(role: str, score: float, provider: str = "openai") -> SignalReport:
    return SignalReport(
        role=role, provider=provider, model="recorded-model", horizon="hours",
        stance="bullish" if score > 0 else "bearish", score=score, confidence=0.8,
        evidence=[], risks=[], expires_at=utc_now() + timedelta(minutes=5),
    )


def test_synthesis_exposes_all_five_visualization_contracts():
    reports = [report("technical_trend", 0.7), report("liquidity", -0.4, "deepseek")]
    runs = [AgentRunView(role=item.role, provider=item.provider, model=item.model, status="completed") for item in reports]
    output = synthesize("BTC-USD", "focus", reports, runs, 250)
    assert output.visualization.forces
    assert isinstance(output.visualization.story, list)
    assert len(output.visualization.scenarios) == 3
    assert output.visualization.agents
    assert output.visualization.galaxy
    assert sum(item.probability for item in output.scenarios) == pytest.approx(1)


def test_invalid_signal_score_is_rejected():
    with pytest.raises(ValidationError):
        report("technical_trend", 1.5)
