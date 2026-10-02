"""Resolve model-selected citation IDs without trusting model-supplied metadata."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .contracts import EvidenceRef, SignalReport


@dataclass(frozen=True)
class CitationResolution:
    selected_ids: tuple[str, ...]
    canonical_refs: tuple[EvidenceRef, ...]
    invalid_ids: tuple[str, ...]


def canonicalize_report_citations(
    report: SignalReport, supplied_refs: Iterable[EvidenceRef],
) -> tuple[SignalReport, CitationResolution]:
    """Keep only exact selected IDs, resolving all metadata from supplied refs.

    Conflicting supplied records for one ID are ambiguous and therefore invalid.
    Any invented or ambiguous ID causes a neutral, zero-confidence abstention;
    IDs remain in the returned resolution for structured audit evidence.
    """
    canonical: dict[str, EvidenceRef] = {}
    ambiguous: set[str] = set()
    for ref in supplied_refs:
        previous = canonical.get(ref.id)
        if previous is not None and previous != ref:
            ambiguous.add(ref.id)
        else:
            canonical[ref.id] = ref

    selected_ids = tuple(ref.id for ref in report.evidence)
    resolved: list[EvidenceRef] = []
    invalid: list[str] = []
    resolved_ids: set[str] = set()
    for identifier in selected_ids:
        ref = canonical.get(identifier)
        if not identifier or identifier in ambiguous or ref is None:
            invalid.append(identifier)
        elif identifier not in resolved_ids:
            resolved.append(ref)
            resolved_ids.add(identifier)
    result = CitationResolution(selected_ids, tuple(resolved), tuple(invalid))
    update = {"evidence": list(result.canonical_refs)}
    if result.invalid_ids:
        update.update({
            "stance": "neutral", "score": 0.0, "confidence": 0.0,
            "decision_summary": (
                "Abstained because selected citation IDs did not resolve to supplied evidence."
            ),
            "risks": [*report.risks[:19],
                      "Selected citation IDs include unresolved evidence."],
        })
    return report.model_copy(update=update), result


def canonicalize_evaluation_citations(
    report: SignalReport, supplied_refs: Iterable[EvidenceRef], call: dict,
) -> SignalReport:
    """Attach the exact selection and resolution to an already metered model call."""
    resolved_report, citation = canonicalize_report_citations(report, supplied_refs)
    call.update({
        "evidence_ids": [ref.id for ref in resolved_report.evidence],
        "selected_evidence_ids": list(citation.selected_ids),
        "invalid_evidence_ids": list(citation.invalid_ids),
        "citation_resolution": "exact_id_only",
        "citation_status": "abstained_invalid_ids" if citation.invalid_ids else "resolved",
    })
    return resolved_report


def mark_citation_validation_unqualified(validation: dict, calls: list[dict]) -> None:
    """Keep model-selected IDs visible in grounding counters without overclaiming proof."""
    validation["citationQualification"] = "unqualified"
    validation["citationResolution"] = "exact_id_only"
    for call in calls:
        invalid_ids = call.get("invalid_evidence_ids", [])
        if invalid_ids:
            validation["flags"].append({
                "code": "invented_citation", "role": call["role"],
                "detail": ",".join(invalid_ids),
            })
            validation["citationCount"] += len(invalid_ids)
    if validation["citationCount"]:
        validation["citationValidityRate"] = (
            validation["validCitationCount"] / validation["citationCount"]
        )
    if validation["flags"]:
        validation["semanticGrounding"] = "pending_sample"
