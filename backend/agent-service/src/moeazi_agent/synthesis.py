import math
import statistics
from datetime import timedelta
from uuid import uuid4

from .contracts import AgentRunView, MarketSynthesis, Scenario, SignalReport, SynthesisDraft, VisualizationPayload, utc_now


DISCLAIMER = "Probabilistic analysis, not financial advice. Conditions can change before execution."


def _probabilities(consensus: float, disagreement: float) -> tuple[float, float, float]:
    bullish = max(0.05, 0.34 + consensus * 0.28 - disagreement * 0.08)
    bearish = max(0.05, 0.34 - consensus * 0.28 - disagreement * 0.08)
    range_bound = max(0.05, 1 - bullish - bearish)
    total = bullish + bearish + range_bound
    return bullish / total, range_bound / total, bearish / total


def synthesize(
    market: str,
    tier: str,
    reports: list[SignalReport],
    runs: list[AgentRunView],
    freshness_ms: int,
    story: list[dict] | None = None,
    galaxy: list[dict] | None = None,
    private_overlay: dict | None = None,
    draft: SynthesisDraft | None = None,
    analysis_id: str | None = None,
) -> MarketSynthesis:
    if not reports:
        raise ValueError("At least one validated signal is required")
    weights = [max(0.05, report.confidence) for report in reports]
    consensus = sum(report.score * weight for report, weight in zip(reports, weights)) / sum(weights)
    disagreement = min(1.0, statistics.pstdev(report.score for report in reports))
    confidence = max(0.0, min(1.0, statistics.mean(report.confidence for report in reports) * (1 - disagreement * 0.35)))
    bull, range_bound, bear = _probabilities(consensus, disagreement)
    scenarios = [
        Scenario(name="Bull continuation", probability=bull, triggers=["Breadth and liquidity confirm"], invalidations=["Support failure"], disclaimer=DISCLAIMER),
        Scenario(name="Range / mean reversion", probability=range_bound, triggers=["Volatility compresses"], invalidations=["Range breakout"], disclaimer=DISCLAIMER),
        Scenario(name="Bear continuation", probability=bear, triggers=["Selling pressure confirms"], invalidations=["Resistance reclaim"], disclaimer=DISCLAIMER),
    ]
    if draft:
        consensus, confidence, scenarios = draft.consensus, draft.confidence, draft.scenarios
    forces = [
        {"role": report.role, "score": report.score, "confidence": report.confidence, "stance": report.stance}
        for report in reports
    ]
    conflicts = list(draft.conflicts) if draft else []
    positive = [report.role for report in reports if report.score > 0.35]
    negative = [report.role for report in reports if report.score < -0.35]
    if positive and negative:
        conflicts.append(f"Bullish {', '.join(positive[:3])} conflicts with bearish {', '.join(negative[:3])}.")
    payload = VisualizationPayload(
        forces=forces, story=story or [], scenarios=scenarios, agents=runs,
        galaxy=galaxy or [{"market": market, "strength": consensus, "sentiment": consensus, "volatility": disagreement, "activity": len(reports)}],
        portfolio=private_overlay.get("portfolio") if private_overlay else None,
        risk_overlay=private_overlay.get("risk_overlay") if private_overlay else None,
    )
    return MarketSynthesis(
        analysis_id=analysis_id or str(uuid4()), market=market, tier=tier, consensus=max(-1, min(1, consensus)),
        confidence=confidence, disagreement=disagreement, freshness_ms=freshness_ms,
        scenarios=scenarios, conflicts=conflicts, visualization=payload,
        valid_until=utc_now() + timedelta(minutes=2 if tier in {"pro", "max"} else 5),
    )
