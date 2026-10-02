"""Closed, checked-in vocabulary.  It deliberately contains no adapter endpoint."""
from __future__ import annotations
import json
from functools import lru_cache
from importlib.resources import files
from .evidence_event_canonical import digest
FAMILIES=("market-data","protocol-state","risk-control","news-class","reconciliation","fixture-audit")
EVENT_CLASSES=("quote","depth","funding","volatility","protocol","risk_override","correction","tombstone")
ROLES=("baseline","price","risk","integrity"); HORIZONS=("intraday","daily","weekly","monthly")
MARKETS=("perpetual","spot"); QUALITY=("authenticity","completeness","timeliness","sequence_continuity","parser_validity","mapping_certainty","source_reliability","sanitization")
OPERATIONS=("freeze_fixture","admit_event","assess_quality","advance_watermark","decide_freshness","decide_materiality","record_trigger_intent","build_replay_manifest","replay","inspect")
def _pairs(rows):
    out={}
    for key,value in rows:
        if key in out: raise ValueError("evidence_registry_duplicate_key")
        out[key]=value
    return out
@lru_cache(maxsize=1)
def registry():
    data=json.loads(files("moeazi_agent").joinpath("evidence_event_registry.json").read_text("utf8"),object_pairs_hook=_pairs)
    if data.get("version")!="2026-09-09.feature-25-local-v1" or tuple(data.get("sourceFamilies",()))!=FAMILIES or tuple(data.get("operations",()))!=OPERATIONS: raise ValueError("evidence_registry_closure_invalid")
    matrix=data.get("freshnessMatrix",[])
    if len(matrix)!=len(FAMILIES)*len(ROLES)*len(MARKETS)*len(HORIZONS) or len({tuple(x.values()) for x in matrix})!=len(matrix): raise ValueError("evidence_registry_matrix_invalid")
    return data
@lru_cache(maxsize=1)
def registry_hash(): return digest(registry())
