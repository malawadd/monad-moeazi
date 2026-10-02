"""Conservative fixture-only role contract evaluation."""
from __future__ import annotations
from .source_value_definition_contracts import ManifestEvidenceItem,RoleEvidenceContract
from .source_value_result_contracts import CitationResolution,RoleEvidenceStatus
def evaluate(contract:RoleEvidenceContract, items:tuple[ManifestEvidenceItem,...], resolution:CitationResolution):
 supporting=[item for item in items if item.id in resolution.supporting]
 families={item.family for item in supporting}; roots={item.root_id for item in supporting}; reasons=[]
 if resolution.invalid: reasons.append("invalid_citation")
 if any(item.family in contract.forbidden for item in supporting): reasons.append("forbidden_family")
 missing=set(contract.required)-families
 if missing: reasons.append("missing_required")
 quality=all(min(item.freshness_bps,item.completeness_bps,item.integrity_bps,item.relevance_bps)>=contract.minimum_quality_bps for item in supporting)
 if not quality: reasons.append("quality_below_contract")
 if len(roots)<contract.min_roots: reasons.append("independence_below_contract")
 if "forbidden_family" in reasons or (contract.critical and reasons): status="block"
 elif missing: status="omit"
 elif reasons or not set(contract.optional).issubset(families): status="degraded"
 else: status="eligible"
 return RoleEvidenceStatus(status,tuple(sorted(reasons)),len(roots))
