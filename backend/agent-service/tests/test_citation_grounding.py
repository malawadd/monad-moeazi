"""Offline regressions for canonical citation selection and audit provenance."""
from datetime import timedelta

import pytest

from moeazi_agent.citation_grounding import (
    canonicalize_evaluation_citations, canonicalize_report_citations,
    mark_citation_validation_unqualified,
)
from moeazi_agent.contracts import EvidenceRef, SignalReport, utc_now
from moeazi_agent.costs import Usage
from moeazi_agent.model_routing import ModelRoute, ModelRouting
from moeazi_agent.orchestrator import AnalysisOrchestrator, AnalysisRequest
from moeazi_agent.providers import DeterministicProvider, ProviderResponse


def _ref(identifier: str, *, source: str = "canonical", content_hash: str = "a" * 64):
    now = utc_now()
    return EvidenceRef(id=identifier, source=source,
        uri=f"http://localhost/{identifier}", observed_at=now,
        quality_score=.8, content_hash=content_hash)


def _report(refs=()):
    return SignalReport(role="technical_trend", provider="deterministic",
        model="fixture", horizon="hours", stance="bullish", score=.5,
        confidence=.7, evidence=list(refs), risks=[],
        decision_summary="Fixture analysis", expires_at=utc_now() + timedelta(minutes=5))


def test_subset_resolves_to_selected_canonical_refs_only():
    first, second = _ref("evidence-1"), _ref("evidence-2")
    report, result = canonicalize_report_citations(_report((second,)), (first, second))
    assert report.evidence == [second]
    assert result.selected_ids == ("evidence-2",)
    assert result.invalid_ids == ()


def test_empty_selection_stays_empty():
    report, result = canonicalize_report_citations(
        _report(), (_ref("evidence-1"), _ref("evidence-2")))
    assert report.evidence == []
    assert result.selected_ids == result.invalid_ids == ()


def test_invented_ids_stay_auditable_and_abstain():
    invented = _ref("invented-id")
    report, result = canonicalize_report_citations(_report((invented,)), ())
    assert report.evidence == []
    assert (report.stance, report.score, report.confidence) == ("neutral", 0, 0)
    assert result.selected_ids == result.invalid_ids == ("invented-id",)


def test_spoofed_metadata_is_replaced_by_exact_supplied_reference():
    canonical = _ref("evidence-1", source="market_feed")
    spoofed = _ref("evidence-1", source="forged", content_hash="b" * 64)
    report, result = canonicalize_report_citations(_report((spoofed,)), (canonical,))
    assert report.evidence == [canonical]
    assert report.evidence[0].source == "market_feed"
    assert report.evidence[0].content_hash == "a" * 64
    assert result.invalid_ids == ()


def test_duplicate_selected_ids_do_not_become_independent_citations():
    canonical = _ref("evidence-1")
    report, result = canonicalize_report_citations(
        _report((canonical, canonical)), (canonical,))
    assert result.selected_ids == ("evidence-1", "evidence-1")
    assert report.evidence == [canonical]


def test_evaluation_call_keeps_metering_and_records_invalid_selection():
    canonical = _ref("evidence-1")
    invented = _ref("invented-id")
    call = {"input_tokens": 17, "output_tokens": 5,
            "provider_cost_microusd": 91}
    report = canonicalize_evaluation_citations(
        _report((canonical, invented)), (canonical,), call)
    assert report.evidence == [canonical] and report.confidence == 0
    assert call["selected_evidence_ids"] == ["evidence-1", "invented-id"]
    assert call["invalid_evidence_ids"] == ["invented-id"]
    assert (call["input_tokens"], call["output_tokens"],
            call["provider_cost_microusd"]) == (17, 5, 91)


def _test_routing():
    route_values = {"provider": "openai", "model": "fixture",
        "credential_source": "byok", "connection_id": "local-fixture",
        "max_output_tokens": 128, "input_price": 1,
        "cached_input_price": 1, "output_price": 1}
    return ModelRouting(schema_version=1, routes=[
        ModelRoute(slot="specialist_default", **route_values),
        ModelRoute(slot="synthesis", **route_values),
    ])


async def _admitted(_stage, content, _evidence_ids):
    return content


async def _verified(_stage):
    return None


class CitationProvider(DeterministicProvider):
    def __init__(self, selected):
        super().__init__()
        self.selected = selected

    async def analyze(self, assignment, market, evidence):
        value = await super().analyze(assignment, market, evidence)
        return ProviderResponse(
            value.model_copy(update={"evidence": list(self.selected)}),
            Usage(input_tokens=17, cached_input_tokens=3, output_tokens=5,
                  provider_cost_microusd=91, cost_source="provider_reported"),
        )


@pytest.mark.asyncio
async def test_orchestrator_records_invalid_ids_but_does_not_trust_them():
    canonical = _ref("evidence-1", source="market_feed")
    invented = _ref("invented-id", source="model_claimed_source")
    provider = CitationProvider((canonical, invented))
    orchestrator = AnalysisOrchestrator(
        {"openai": provider}, lifecycle_gate=_admitted,
        lifecycle_dispatch_gate=_verified,
    )
    result = await orchestrator.run(AnalysisRequest(
        market="BTC-USD", tier="focus", scope="public",
        model_routing=_test_routing(),
        evidence_refs=(canonical, _ref("evidence-2")),
    ))
    assert all(report.evidence == [canonical] for report in result.reports)
    assert all((report.stance, report.score, report.confidence) == ("neutral", 0, 0)
               for report in result.reports)
    specialist_calls = [call for call in result.calls if call["role"] != "synthesis"]
    assert all(call["selected_evidence_ids"] == ["evidence-1", "invented-id"]
               for call in specialist_calls)
    assert all(call["evidence_ids"] == ["evidence-1"] and
               call["invalid_evidence_ids"] == ["invented-id"] and
               call["citation_status"] == "abstained_invalid_ids" and
               call["citation_resolution"] == "exact_id_only" and
               call["input_tokens"] == 17 and call["output_tokens"] == 5 and
               call["provider_cost_microusd"] == 91
               for call in specialist_calls)


def test_invalid_citation_audit_marks_validation_unqualified():
    validation = {"flags": [], "citationCount": 1, "validCitationCount": 1,
        "citationValidityRate": 1.0, "semanticGrounding": "not_sampled"}
    mark_citation_validation_unqualified(validation, [{
        "role": "technical_trend", "invalid_evidence_ids": ["invented-id"],
    }])
    assert validation["citationQualification"] == "unqualified"
    assert validation["citationValidityRate"] == .5
    assert validation["flags"] == [{"code": "invented_citation",
        "role": "technical_trend", "detail": "invented-id"}]
