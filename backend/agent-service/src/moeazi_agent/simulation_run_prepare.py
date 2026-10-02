"""Owned, hash-derived preparation of a stored-evidence simulation run."""
from __future__ import annotations

import json
from datetime import timedelta

from fastapi import APIRouter, Header, HTTPException, Request
from sqlalchemy import text

from .account_observation_storage import AccountObservationRepository
from .config import get_settings
from .convex import ConvexWorkerClient
from .finance_contracts import FinanceError, FinanceScope, _digest
from .finance_policy import SizingPolicy
from .finance_routes import _subject
from .lifecycle_dataset import SOURCE_MAX_AGE_MS
from .lifecycle_run_contracts import (
    ExperimentProtectionPolicyV1, SimulationRunManifest, SimulationScenario, simulation_dataset_hash,
)
from .lifecycle_strategy import ReplayStrategyRule
from .lifecycle_execution_envelope import CAUSAL_MODEL_VERSION
from .lifecycle_simulator_models import CAUSAL_MODEL_HASH
from .observation_contracts import EvidenceSnapshot, InstrumentVersion, MarketObservation, canonical_hash
from .observation_replay import replay_observations
from .observation_storage import ObservationRepository
from .simulation_authority import SimulationIdentity, require_simulation_identity
from .simulation_run_prepare_contracts import (
    ProtectionDraft, RuleDraft, RunPreparationRequest, ScenarioDraft,
)


router = APIRouter(tags=["simulated trading lifecycle"])
LABEL = {"environment": "experiment", "authority": "simulation_only",
         "executionQualified": False}

async def _identity(subject: str, experiment_spec_id: str) -> SimulationIdentity:
    client = ConvexWorkerClient(get_settings())
    try:
        return await require_simulation_identity(client, subject, experiment_spec_id)
    except Exception as exc:
        raise HTTPException(status_code=403,
            detail="Current simulation identity is unavailable.") from exc
    finally:
        await client.client.aclose()


def _rule(draft: RuleDraft) -> ReplayStrategyRule:
    body = draft.model_dump(mode="json")
    body["rule_hash"] = _digest("moeazi-replay-strategy-rule-v1", body)
    return ReplayStrategyRule.model_validate_json(json.dumps(body, allow_nan=False))


def _scenario(draft: ScenarioDraft, ordered: tuple[MarketObservation, ...]) -> SimulationScenario:
    body = draft.model_dump(mode="json", exclude_none=True)
    body["model_version"] = CAUSAL_MODEL_VERSION
    body["model_hash"] = CAUSAL_MODEL_HASH
    body["dataset_hash"] = simulation_dataset_hash(ordered)
    body["scenario_hash"] = _digest("moeazi-simulation-scenario-v1", body)
    return SimulationScenario.model_validate_json(json.dumps(body, allow_nan=False))


def _protection(draft: ProtectionDraft | None) -> ExperimentProtectionPolicyV1 | None:
    if draft is None:
        return None
    body = draft.model_dump(mode="json")
    body["policy_hash"] = _digest("moeazi-experiment-protection-policy-v1", body)
    return ExperimentProtectionPolicyV1.model_validate_json(json.dumps(body, allow_nan=False))


async def _finance_binding(finance, scope: FinanceScope, instrument_id: str):
    risk = await finance.read_account_risk_snapshot(scope)
    if risk.get("reconciliationState") != "clean":
        raise FinanceError("Experiment account is not currently clean")
    revision = int(risk["accountRevision"])
    async with finance.engine.connect() as conn:
        account = (await conn.execute(text("""
            SELECT revision,reconciliation_state,source_account_id,
                   observation_snapshot_hash,policy_version,policy_hash
            FROM finance_accounts WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
        """), {"environment": scope.environment, "scope_id": scope.scope_id,
              "strategy_account_id": scope.strategy_account_id})).mappings().first()
        if account is None or int(account["revision"]) != revision or \
                account["reconciliation_state"] != "clean" or \
                account["observation_snapshot_hash"] != risk.get("observationSnapshotHash"):
            raise FinanceError("Experiment account changed during preparation")
        policy_row = (await conn.execute(text("""
            SELECT policy_json,policy_hash FROM finance_policy_versions
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND policy_version=:version
        """), {"environment": scope.environment, "scope_id": scope.scope_id,
              "strategy_account_id": scope.strategy_account_id,
              "version": account["policy_version"]})).mappings().first()
    if policy_row is None or policy_row["policy_hash"] != account["policy_hash"]:
        raise FinanceError("Current experiment policy is unavailable")
    policy = SizingPolicy.model_validate(policy_row["policy_json"])
    if policy.policy_hash != account["policy_hash"] or policy.policy_version != account["policy_version"] \
            or policy.approved_live is not False or policy.instrument_version_id != instrument_id:
        raise FinanceError("Current experiment policy does not match this simulation")
    snapshot = await AccountObservationRepository(finance.engine).load_by_hash(
        account["observation_snapshot_hash"])
    if snapshot is None or snapshot.scope != scope or snapshot.policy_version != policy.policy_version \
            or snapshot.origin != "recorded_fixture" or \
            not snapshot.source_account_id.startswith("fixture:") or \
            snapshot.rights_ref != "internal_qualification_only" or \
            snapshot.status != "accepted" or snapshot.finality != "admitted_final" or \
            snapshot.finality_at is None or snapshot.has_gap or snapshot.has_reorg or \
            not snapshot.balances_complete or not snapshot.positions_complete:
        raise FinanceError("Current experiment account observation is not a clean fixture")
    if account["source_account_id"] != snapshot.source_account_id:
        raise FinanceError("Current experiment account source differs from its observation")
    return risk, policy, snapshot


async def _stored_observations(engine, hashes: tuple[str, ...], instrument_id: str,
                               cutoff, simulation_cursor, simulation_end,
                               max_book_age_ms: int) -> tuple[
                                   InstrumentVersion, tuple[MarketObservation, ...],
                                   EvidenceSnapshot]:
    async with engine.connect() as conn:
        instrument_row = (await conn.execute(text("""
            SELECT instrument_version_id,registry_hash,manifest
            FROM observation_instrument_versions WHERE instrument_version_id=:id
        """), {"id": instrument_id})).mappings().first()
        rows = (await conn.execute(text("""
            SELECT observation_hash,normalized_body,source_kind,source_rights_ref,
                   instrument_version_id,source_id,source_event_id,raw_payload_hash
            FROM observation_market_events
            WHERE observation_hash = ANY(CAST(:hashes AS text[]))
        """), {"hashes": list(hashes)})).mappings().all()
    if instrument_row is None or len(rows) != len(hashes):
        raise FinanceError("Selected replay source or instrument is unavailable")
    instrument = InstrumentVersion.model_validate(instrument_row["manifest"])
    if instrument.instrument_version_id != instrument_id or \
            instrument.registry_hash != instrument_row["registry_hash"]:
        raise FinanceError("Stored instrument registry differs")
    by_hash = {row["observation_hash"]: row for row in rows}
    if len(by_hash) != len(hashes):
        raise FinanceError("Stored replay source hash is ambiguous")
    observations = []
    for observation_hash in hashes:
        row = by_hash.get(observation_hash)
        if row is None:
            raise FinanceError("Selected replay source is missing")
        observation = MarketObservation.model_validate(row["normalized_body"])
        body = observation.model_dump(mode="json")
        if canonical_hash(body) != observation_hash or dict(row["normalized_body"]) != body or \
                row["source_kind"] != observation.source_kind or \
                row["source_rights_ref"] != observation.source_rights_ref or \
                row["instrument_version_id"] != observation.instrument_version_id or \
                row["source_id"] != observation.source_id or \
                row["source_event_id"] != observation.source_event_id or \
                row["raw_payload_hash"] != observation.raw_payload_hash or \
                observation.instrument_version_id != instrument_id or \
                observation.source_kind != "recorded_native" or \
                observation.source_rights_ref != "internal_qualification_only" or \
                observation.received_at > simulation_end:
            raise FinanceError("Selected replay source differs from its admitted stored body")
        received_evidence = replay_observations((instrument,), (observation,),
            observation.received_at, SOURCE_MAX_AGE_MS)
        if received_evidence.excluded or received_evidence.has_gap or \
                received_evidence.accepted_observation_hashes != (observation_hash,) or \
                received_evidence.instrument_version_ids != (instrument_id,) or \
                received_evidence.source_rights_refs != ("internal_qualification_only",):
            raise FinanceError("Selected replay source was not admitted at receipt")
        observations.append(observation)
    ordered = tuple(observations)
    if any(observation.available_at <= cutoff < observation.received_at
           for observation in ordered):
        raise FinanceError("Replay source was not received by the evidence cutoff")
    prefix = tuple(observation for observation in ordered
                   if observation.received_at <= cutoff)
    evidence = replay_observations((instrument,), prefix, cutoff, SOURCE_MAX_AGE_MS)
    accepted = set(evidence.accepted_observation_hashes)
    if any(row.reason != "stale_at_cutoff" for row in evidence.excluded) or \
            evidence.has_gap or \
            evidence.instrument_version_ids != (instrument_id,) or \
            evidence.source_rights_refs not in {(), ("internal_qualification_only",)}:
        raise FinanceError("Selected replay prefix is not admissible at the evidence cutoff")
    selected = max((observation for observation in ordered
                    if observation.available_at <= cutoff),
        key=lambda observation: (observation.available_at, observation.event_at,
                                 observation.source_event_id), default=None)
    if selected is None or \
            canonical_hash(selected.model_dump(mode="json")) not in accepted or \
            simulation_cursor - selected.event_at > timedelta(milliseconds=max_book_age_ms):
        raise FinanceError("Latest decision-time book is unavailable or stale")
    return instrument, ordered, evidence


async def _prepare(finance, identity: SimulationIdentity, body: RunPreparationRequest) -> dict:
    if identity.scope.environment != "experiment" or identity.scope.scope_id != body.experiment_spec_id:
        raise FinanceError("Owned experiment identity differs from the request")
    if body.scenario.queue_model != "no_queue_estimate" or \
            body.scenario.funding_rules or body.scenario.outcome_rules or \
            any(value is None for value in (body.scenario.max_execution_deviation_bps,
                body.scenario.order_time_in_force_ms, body.scenario.max_fill_events_per_order)):
        raise FinanceError("Preparation requires the qualified causal v2 replay model")
    rule = _rule(body.rule)
    risk, policy, snapshot = await _finance_binding(finance, identity.scope,
                                                     rule.instrument_version_id)
    instrument, ordered, evidence = await _stored_observations(finance.engine,
        body.observation_hashes, rule.instrument_version_id,
        body.scenario.evidence_cutoff_at, body.scenario.simulation_cursor_at,
        body.scenario.simulation_end_at,
        body.scenario.max_book_age_ms)
    if (rule.action.startswith("spot_") and instrument.product_kind != "spot") or \
            (rule.action.startswith("perp_") and instrument.product_kind != "perpetual"):
        raise FinanceError("Strategy action and stored instrument kind differ")
    if identity.dataset_hash is not None and \
            identity.dataset_hash != simulation_dataset_hash(ordered):
        raise FinanceError("Selected replay corpus differs from the owned experiment identity")
    # Scenario construction is deliberately delayed until the exact SQL corpus is validated.
    scenario = _scenario(body.scenario, ordered)
    if scenario.funding_rules or scenario.outcome_rules:
        raise FinanceError("Causal replay does not accept scheduled future economics")
    protection = _protection(body.protection_policy)
    if rule.action in {"spot_buy", "perp_open", "perp_increase"} and protection is None:
        raise FinanceError("Causal increases require a bounded experiment protection policy")
    manifest_body = {
        "schema_version": 1, "scope": identity.scope,
        "controller_ref": identity.controller_ref, "controller_mode": "shadow",
        "run_id": body.run_id, "strategy_artifact_hash": rule.rule_hash,
        "policy_version": policy.policy_version, "policy_hash": policy.policy_hash,
        "instrument_version_ids": (instrument.instrument_version_id,),
        "evidence_snapshot_hash": evidence.snapshot_hash,
        "account_snapshot_hash": snapshot.snapshot_hash, "scenario": scenario,
        "protection_policy": protection,
    }
    manifest_json = SimulationRunManifest.model_construct(**manifest_body).model_dump(
        mode="json", exclude={"manifest_hash"})
    manifest = SimulationRunManifest.model_validate_json(json.dumps({**manifest_json,
        "manifest_hash": _digest("moeazi-simulation-run-v1", manifest_json)}, allow_nan=False))
    from .lifecycle_simulator_causal_inputs import validate_causal_corpus

    validate_causal_corpus(manifest, {instrument.instrument_version_id: instrument}, ordered)
    stored_hash = await ObservationRepository(finance.engine).store_evidence_snapshot(evidence)
    if stored_hash != evidence.snapshot_hash:
        raise FinanceError("Persisted evidence snapshot identity changed")
    return {**LABEL, "controllerMode": "shadow",
        "experimentSpecId": body.experiment_spec_id,
        "runId": body.run_id, "observationHashes": list(body.observation_hashes),
        "datasetHash": scenario.dataset_hash, "evidenceSnapshotHash": evidence.snapshot_hash,
        "expectedRevision": int(risk["accountRevision"]), "policyVersion": policy.policy_version,
        "policyHash": policy.policy_hash, "accountSnapshotHash": snapshot.snapshot_hash,
        "manifestHash": manifest.manifest_hash,
        "scenarioHash": scenario.scenario_hash,
        "rule": rule.model_dump(mode="json"),
        "manifest": manifest.model_dump(mode="json")}


@router.post("/runs/prepare")
async def prepare_run(body: dict, request: Request,
                      authorization: str | None = Header(default=None),
                      x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    try:
        body = RunPreparationRequest.model_validate_json(json.dumps(body, allow_nan=False))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Invalid simulation preparation request.") from exc
    identity = await _identity(subject, body.experiment_spec_id)
    finance = getattr(request.app.state, "finance", None)
    if finance is None:
        raise HTTPException(status_code=503, detail="Simulation preparation is unavailable.")
    try:
        return await _prepare(finance, identity, body)
    except (FinanceError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=409,
            detail="Simulation preparation prerequisites are not currently satisfied.") from exc
    except Exception as exc:
        raise HTTPException(status_code=503,
            detail="Simulation preparation is temporarily unavailable.") from exc
