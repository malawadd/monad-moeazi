"""Checked-in deterministic synthetic corpus adapter; never accepts caller facts."""
from __future__ import annotations
from .decision_memory_canonical import digest
from .decision_memory_episode_contracts import DecisionEpisode, EpisodeVersionRefs
from .decision_memory_maturity import evaluate as maturity
from .decision_memory_outcome_contracts import OutcomeObservationRevision
from .decision_memory_registry import registry_hash, scenarios
from .decision_memory_retrieval import retrieve
from .decision_memory_retrieval_contracts import RetrievalQuery
from .decision_memory_scoring import score
from .decision_memory_scope_contracts import DecisionMemoryScope


def scenario_registry(): return scenarios()


def _scope(operator: str):
    value={"operator_id":operator,"tenant_fixture":"tenant-fixture","account_fixture":"account-fixture","chain_id":42161,
           "market":"arb-usdc","horizon":"one-hour","regime":"range","role":"synthesis","permission_scope":"fixture-inspection"}
    return DecisionMemoryScope(**value, scope_hash=digest(value))


def _episode(operator: str):
    scope=_scope(operator); refs_value={"evidence_root_hash":digest({"evidence":"fixture"}),"evidence_as_of":"2026-01-01T00:00:00Z",
      "prompt_bundle_hash":digest({"prompt":"fixture"}),"policy_hash":digest({"policy":"fixture"}),"scorer_version":"decision-memory-local-v1"}
    refs=EpisodeVersionRefs(**refs_value)
    raw={"episode_id":"episode-001","analysis_id":"analysis-001","scope":scope,"refs":refs,
      "forecast_bps":(7000,1000,2000),"abstained":False,"declared_horizon_end":"2026-01-01T02:00:00Z","decision_time":"2026-01-01T01:00:00Z","created_at":"2026-01-01T01:00:00Z"}
    hashed={**raw,"scope":scope.model_dump(mode="json"),"refs":refs.model_dump(mode="json")}
    return DecisionEpisode(**raw, episode_hash=digest(hashed))


def _outcome(kind: str):
    raw={"episode_id":"episode-001","horizon":"one-hour","revision":1,"predecessor_hash":None,"source_time":"2026-01-01T02:01:00Z",
      "evaluated_at":"2026-01-01T02:02:00Z","as_of":"2026-01-01T02:03:00Z","created_at":"2026-01-01T02:03:00Z","realized_direction":"up",
      "return_bps":100,"quality":"low" if kind=="low-quality" else "passing","disputed":kind=="disputed","corrected":kind=="corrected","reconciled":kind not in {"disputed"},"certified_actual":False}
    return OutcomeObservationRevision(**raw, revision_hash=digest(raw))


def evaluate_fixture(identifier, mode, now, operator, run_hash, context=None, controls=None):
    del now, controls
    row=next((item for item in scenarios() if item["id"]==identifier),None)
    if not row: raise ValueError("decision_memory_unknown_scenario")
    episode=_episode(operator); outcome=_outcome(row["kind"]); as_of="2026-01-01T03:00:00Z" if row["kind"]!="pending" else "2026-01-01T01:30:00Z"
    receipt=maturity(episode,(outcome,),as_of); episode_score=score(episode,outcome,receipt)
    query_raw={"query_id":"query-001","scope_hash":episode.scope.scope_hash,"decision_time":"2026-01-01T04:00:00Z","as_of":as_of,"top_k":5,"token_ceiling":2048,"algorithm_version":"decision-memory-local-v1"}
    query=RetrievalQuery(**query_raw,query_hash=digest(query_raw)); bundle=retrieve(query,((episode,receipt,episode_score),))
    return {"scenarioId":identifier,"fixtureHash":digest(row),"registryHash":registry_hash(),"invariantVerdict":"pass","fixtureOnly":True,
      "productOutcome":"unavailable","authorityEffect":"none","onlineModificationAvailable":False,"episodeRevision":1,"outcomeRevision":outcome.revision,
      "maturity":receipt.status,"maturityReasons":list(receipt.reasons),"scoreAvailable":episode_score is not None,"candidateState":"evaluation_only",
      "retrievalStatus":bundle.status,"topK":query.top_k,"tokenUse":bundle.token_count,"categoryCoverage":len({x.category for x in bundle.members}),"counterexampleCoverage":False,
      "invalidationStatus":"none","experimentEligibility":"hold","selectedPrerequisiteStatus":(context or {}).get("trustStatus","requires_revalidation"),
      "providerAttempts":0,"externalAttempts":0,"workflowAttempts":0,"signerAttempts":0,"walletAttempts":0,"venueAttempts":0,"creditAttempts":0,"providerCost":0,
      "rootHash":digest({"episode":episode.episode_hash,"outcome":outcome.revision_hash,"receipt":receipt.receipt_hash,"bundle":bundle.bundle_hash,"run":run_hash}),
      "_artifacts":{"episode":episode,"outcome":outcome,"receipt":receipt,"score":episode_score,"bundle":bundle}}
