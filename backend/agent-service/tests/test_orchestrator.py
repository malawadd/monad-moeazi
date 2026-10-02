from datetime import timedelta

import pytest

from moeazi_agent.contracts import EvidenceRef, SignalReport, utc_now
from moeazi_agent.orchestrator import AnalysisOrchestrator, AnalysisRequest
from moeazi_agent.providers import DeterministicProvider, ProviderFailure
from moeazi_agent.roles import assignments_for_tier


async def admitted(_stage, content, _evidence_ids):
    return content


async def verified(_stage):
    return None


def governed_orchestrator(providers, **kwargs):
    return AnalysisOrchestrator(providers, lifecycle_gate=admitted,
        lifecycle_dispatch_gate=verified, **kwargs)


async def test_focus_runs_six_concurrent_assignments():
    provider = DeterministicProvider()
    orchestrator = governed_orchestrator(
        {"openai": provider, "deepseek": provider}, max_concurrency=3)
    result = await orchestrator.run(AnalysisRequest(market="BTC-USD", tier="focus", scope="public"))
    assert len(result.reports) == 6
    assert len(result.calls) == 7
    assert result.calls[-1]["role"] == "synthesis"
    assert result.synthesis.tier == "focus"


async def test_worker_keeps_empty_model_selected_citations_empty():
    provider = DeterministicProvider()
    evidence = EvidenceRef(
        id="evidence-1", source="test", uri="http://localhost/evidence",
        observed_at=utc_now(), quality_score=.8, content_hash="a" * 64,
    )
    result = await governed_orchestrator(
        {"openai": provider, "deepseek": provider}, max_concurrency=3,
    ).run(AnalysisRequest(
        market="BTC-USD", tier="focus", scope="public", evidence_refs=(evidence,),
    ))
    assert all(report.evidence == [] for report in result.reports)


async def test_deepseek_only_mode_allows_pro_quorum_without_faking_provider_names():
    provider = DeterministicProvider()
    result = await governed_orchestrator(
        {"openai": provider, "deepseek": provider}, max_concurrency=8,
        allow_single_provider=True,
    ).run(AnalysisRequest(market="BTC-USD", tier="pro", scope="public"))
    assert len(result.reports) == 16
    assert {call["provider"] for call in result.calls} == {"deterministic"}


async def test_lite_mode_runs_two_specialists_and_deterministic_synthesis():
    provider = DeterministicProvider()
    result = await governed_orchestrator(
        {"openai": provider, "deepseek": provider},
        max_concurrency=1,
        allow_single_provider=True,
    ).run(AnalysisRequest(
        market="BTC-USD", tier="max", scope="private", lite_mode=True,
    ))
    assert len(result.reports) == 2
    assert len(result.calls) == 2
    assert {report.role for report in result.reports} == {"technical_trend", "liquidity"}


async def test_lifecycle_gate_blocks_before_any_provider_call():
    class CountingProvider(DeterministicProvider):
        calls = 0

        async def analyze(self, assignment, market, evidence):
            self.calls += 1
            return await super().analyze(assignment, market, evidence)

    async def blocked_gate(stage, content, evidence_ids):
        raise RuntimeError("Evidence lifecycle blocks provider request")

    provider = CountingProvider()
    orchestrator = AnalysisOrchestrator({"openai": provider, "deepseek": provider},
        max_concurrency=1, lifecycle_gate=blocked_gate,
        lifecycle_dispatch_gate=verified)
    with pytest.raises(RuntimeError, match="lifecycle blocks"):
        await orchestrator.run(AnalysisRequest(
            market="BTC-USD", tier="max", scope="private", lite_mode=True))
    assert provider.calls == 0


def _report(role: str, provider: str, model: str) -> SignalReport:
    return SignalReport(
        role=role, provider=provider, model=model, horizon="hours",
        stance="neutral", score=0, confidence=.6, evidence=[], risks=[],
        expires_at=utc_now() + timedelta(minutes=5),
    )


def test_pro_quorum_uses_model_family_not_gateway_or_host():
    assignments = assignments_for_tier("pro")
    reports = [
        _report(item.role.name, "openrouter", "model") for item in assignments[:8]
    ]
    calls = [
        {"status": "completed", "model_family": "anthropic", "upstream_provider": f"host-{index}"}
        for index in range(8)
    ]
    orchestrator = AnalysisOrchestrator({"openrouter": DeterministicProvider()})
    with pytest.raises(ProviderFailure, match="provider quorum"):
        orchestrator._enforce_quorum("pro", assignments, reports, calls)

    calls[-1]["model_family"] = "google"
    orchestrator._enforce_quorum("pro", assignments, reports, calls)


def test_unknown_openrouter_identity_cannot_supply_second_quorum_family():
    assignments = assignments_for_tier("pro")
    reports = [
        _report(item.role.name, "openrouter", "model") for item in assignments[:8]
    ]
    calls = [{"status": "completed", "model_family": "anthropic"} for _ in range(7)]
    calls.append({"status": "completed", "model_family": "unknown"})
    with pytest.raises(ProviderFailure, match="provider quorum"):
        AnalysisOrchestrator({"openrouter": DeterministicProvider()})._enforce_quorum(
            "pro", assignments, reports, calls,
        )
