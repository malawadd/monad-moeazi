"""Deterministic identity resolution for synthetic cited evidence."""
from __future__ import annotations
from datetime import datetime,timezone
from .source_value_definition_contracts import ManifestEvidenceItem,SpecialistCitationOutput,SourceValueScope
from .source_value_result_contracts import CitationResolution
def resolve(items:tuple[ManifestEvidenceItem,...], output:SpecialistCitationOutput, scope:SourceValueScope, cutoff:str):
 now=datetime.fromisoformat(cutoff.replace("Z","+00:00")); supplied=tuple(item.id for item in items); by_id={item.id:item for item in items}; valid=[]; invalid=[]
 for identifier in output.cited_evidence_ids:
  item=by_id.get(identifier)
  if not item or item.scope.scope_hash!=scope.scope_hash or item.lifecycle!="available": invalid.append(identifier); continue
  observed=datetime.fromisoformat(item.observed_at.replace("Z","+00:00")); expires=datetime.fromisoformat(item.expires_at.replace("Z","+00:00"))
  if observed>now or expires<now: invalid.append(identifier)
  else: valid.append(identifier)
 return CitationResolution(supplied,output.cited_evidence_ids,tuple(valid),tuple(sorted(invalid)))
