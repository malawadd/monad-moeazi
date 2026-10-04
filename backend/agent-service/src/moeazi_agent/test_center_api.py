import json; import re; from datetime import datetime, timezone; from fastapi import APIRouter, Header, HTTPException, Request; from fastapi.responses import StreamingResponse
from .config import get_settings; from .test_center import ControlUpdate, RunRequest, TestCenterRepository, audit_snapshot, canonical_hash, cas_controls, controls_key, feature_is_testable, freeze_control_snapshot, get_controls, operator_test_id, registry_response, run_fixture
from .recovery_storage import RecoveryRepository, transition_rows; from .operational_secret_storage import OperationalSecretRepository; from .strategy_termination_storage import StrategyTerminationRepository; from .incident_communication_storage import IncidentCommunicationRepository; from .safety_change_quorum_storage import SafetyChangeQuorumRepository
from .test_center_common import sanitize_artifact; router=APIRouter(prefix="/internal/test-center",tags=["isolated test center"]); settings=get_settings(); SESSION_PATTERN=re.compile(r"^[a-f0-9]{64}$")
from .test_center_public import public_run_response
def authorize(authorization: str | None, subject: str | None, session_id: str | None) -> str:
    if authorization != f"Bearer {settings.worker_shared_secret.get_secret_value()}" or not subject or subject not in settings.test_center_operator_set:
        raise HTTPException(status_code=401, detail="Test Center operator authorization is required")
    if not session_id or not SESSION_PATTERN.fullmatch(session_id):
        raise HTTPException(status_code=401, detail="Test Center session binding is invalid")
    if not settings.agent_test_center_enabled: raise HTTPException(status_code=404, detail="Test Center is unavailable")
    return operator_test_id(subject, session_id)
repository=lambda request: TestCenterRepository(request.app.state.repository.engine)
@router.get("/prerequisites/verified-strategy-termination")
async def termination_prerequisites(request: Request, authorization: str | None = Header(default=None), subject: str | None = Header(default=None, alias="X-Moeazi-Subject"), session_id: str | None = Header(default=None, alias="X-Moeazi-Session-Id")):
    operator = authorize(authorization, subject, session_id); return {"runs": await StrategyTerminationRepository(request.app.state.repository.engine).prerequisites(operator)}
from .test_center_controls_api import router as controls_router; from .test_center_usage_rights import router as usage_rights_router; from .test_center_product_eligibility import router as eligibility_router; from .test_center_customer_contestation import router as contestation_router; from .test_center_portability import router as portability_router; from .test_center_evidence_event import router as evidence_event_router; from .test_center_claim_disagreement import router as claim_disagreement_router; from .test_center_source_value import router as source_value_router; from .test_center_evidence_integrity import router as evidence_integrity_router; from .test_center_portfolio_sizing import router as portfolio_sizing_router; from .test_center_execution_quality import router as execution_quality_router; from .test_center_shadow_tca import router as shadow_tca_router; from .test_center_run_planning import router as run_planning_router; from .test_center_decision_memory import router as decision_memory_router; from .test_center_promotion import router as promotion_router; from .test_center_selective_prediction import router as selective_prediction_router; from .test_center_analytical_diversity import router as analytical_diversity_router; router.routes.extend(controls_router.routes); router.routes.extend(usage_rights_router.routes); router.routes.extend(eligibility_router.routes); router.routes.extend(contestation_router.routes); router.routes.extend(portability_router.routes); router.routes.extend(evidence_event_router.routes); router.routes.extend(claim_disagreement_router.routes); router.routes.extend(source_value_router.routes); router.routes.extend(evidence_integrity_router.routes); router.routes.extend(portfolio_sizing_router.routes); router.routes.extend(execution_quality_router.routes); router.routes.extend(shadow_tca_router.routes); router.routes.extend(run_planning_router.routes); router.routes.extend(decision_memory_router.routes); router.routes.extend(promotion_router.routes); router.routes.extend(selective_prediction_router.routes); router.routes.extend(analytical_diversity_router.routes)
@router.post("/runs")
async def create_run(body: RunRequest, request: Request, authorization: str | None = Header(default=None), subject: str | None = Header(default=None, alias="X-Moeazi-Subject"), session_id: str | None = Header(default=None, alias="X-Moeazi-Session-Id")):
    operator = authorize(authorization, subject, session_id)
    try: controls = await freeze_control_snapshot(request.app.state.redis, operator, body.feature_id, body.control_hash)
    except RuntimeError as exc: raise HTTPException(status_code=409, detail=str(exc)) from exc
    if controls["effectiveMode"] not in {"observe", "enforce"} or "evaluate" not in controls["layers"]:
        raise HTTPException(status_code=409, detail="Test Center evaluation layer is conservatively off")
    selected_ids = body.prerequisite_run_ids if body.feature_id in {"verified-strategy-termination","risk-tiered-approval-consent","external-usage-rights","external-product-eligibility","customer-contestation","customer-account-portability","evidence-event-fabric","claim-disagreement-ledger","specialist-source-value-attribution","manipulation-aware-evidence-integrity","portfolio-aware-sizing","multi-venue-execution-quality-routing","calibrated-shadow-execution-tca","deterministic-run-planning","outcome-linked-decision-memory","outcome-calibrated-promotion","calibrated-selective-prediction","analytical-diversity-audit"} else None; request_identity = {"featureId": body.feature_id, "scenarioId": body.scenario_id, "controlHash": body.control_hash, "idempotencyKey": body.idempotency_key}
    if selected_ids: request_identity["prerequisiteRunIds"] = selected_ids
    expected_request_hash = canonical_hash(request_identity); feature19_context = usage_rights_context = eligibility_context = contestation_context = evidence_event_context = claim_disagreement_context = source_value_context = evidence_integrity_context = portfolio_sizing_context = execution_quality_context = shadow_tca_context = run_planning_context = decision_memory_context = promotion_context = selective_prediction_context = analytical_diversity_context = None
    if body.request_hash != expected_request_hash: raise HTTPException(status_code=400, detail="Test Center request hash mismatch")
    if body.feature_id == "risk-tiered-approval-consent":
        try: feature19_context = await __import__("moeazi_agent.test_center_risk_tiered_consent",fromlist=["select_feature19_context"]).select_feature19_context(repository(request),operator,(selected_ids or {}).get("effective-authority-decision",""))
        except ValueError as exc: raise HTTPException(status_code=409,detail=str(exc)) from exc
    if body.feature_id == "external-usage-rights": usage_rights_context = await __import__("moeazi_agent.test_center_usage_rights",fromlist=["select_feature03_context"]).select_feature03_context(repository(request),operator,selected_ids)
    if body.feature_id == "external-product-eligibility":
        try: eligibility_context=await __import__("moeazi_agent.test_center_product_eligibility",fromlist=["select_feature21_context"]).select_feature21_context(repository(request),operator,selected_ids)
        except ValueError as exc: raise HTTPException(status_code=409,detail=str(exc)) from exc
    if body.feature_id == "customer-contestation":
        try: contestation_context=await __import__("moeazi_agent.test_center_customer_contestation",fromlist=["select_feature20_context"]).select_feature20_context(repository(request),operator,selected_ids)
        except ValueError as exc: raise HTTPException(status_code=409,detail=str(exc)) from exc
    if body.feature_id == "customer-account-portability": portability_context=await __import__("moeazi_agent.test_center_portability",fromlist=["select_feature03_context"]).select_feature03_context(repository(request),operator,selected_ids)
    if body.feature_id == "evidence-event-fabric": evidence_event_context=await __import__("moeazi_agent.test_center_evidence_event",fromlist=["select_feature03_context"]).selected_context_for_scenario(repository(request),operator,selected_ids,body.scenario_id)
    if body.feature_id == "claim-disagreement-ledger": claim_disagreement_context=await __import__("moeazi_agent.test_center_claim_disagreement",fromlist=["select_context"]).select_context(repository(request),operator,selected_ids)
    if body.feature_id == "specialist-source-value-attribution": source_value_context=await __import__("moeazi_agent.test_center_source_value",fromlist=["select_context"]).select_context(repository(request),operator,selected_ids)
    if body.feature_id == "manipulation-aware-evidence-integrity": evidence_integrity_context=await __import__("moeazi_agent.test_center_evidence_integrity",fromlist=["select_context"]).select_context(repository(request),operator,selected_ids)
    if body.feature_id == "portfolio-aware-sizing": portfolio_sizing_context=await __import__("moeazi_agent.test_center_portfolio_sizing",fromlist=["select_context"]).select_context(repository(request),operator,selected_ids)
    if body.feature_id == "multi-venue-execution-quality-routing": execution_quality_context=await __import__("moeazi_agent.test_center_execution_quality",fromlist=["select_context"]).select_context(repository(request),operator,selected_ids)
    if body.feature_id == "calibrated-shadow-execution-tca": shadow_tca_context=await __import__("moeazi_agent.test_center_shadow_tca",fromlist=["select_context"]).select_context(repository(request),operator,selected_ids)
    if body.feature_id == "deterministic-run-planning": run_planning_context=await __import__("moeazi_agent.test_center_run_planning",fromlist=["select_context"]).select_context(repository(request),operator,selected_ids)
    if body.feature_id == "outcome-linked-decision-memory": decision_memory_context=await __import__("moeazi_agent.test_center_decision_memory",fromlist=["select_context"]).select_context(repository(request),operator,selected_ids, __import__("moeazi_agent.decision_memory_scenarios",fromlist=["_scope"])._scope(operator).scope_hash)
    if body.feature_id == "outcome-calibrated-promotion": promotion_context=await __import__("moeazi_agent.test_center_promotion",fromlist=["select_context"]).select_context(repository(request),operator,selected_ids)
    if body.feature_id == "calibrated-selective-prediction": selective_prediction_context=await __import__("moeazi_agent.test_center_selective_prediction",fromlist=["select_context"]).select_context(repository(request),operator,selected_ids)
    if body.feature_id == "analytical-diversity-audit": analytical_diversity_context=await __import__("moeazi_agent.test_center_analytical_diversity",fromlist=["select_context"]).select_context(repository(request),operator,selected_ids)
    try: existing = await repository(request).idempotent_run(operator, body.idempotency_key, body.request_hash) if body.feature_id not in {"mandate-policy-semantic-fidelity","risk-tiered-approval-consent","outcome-linked-decision-memory","outcome-calibrated-promotion","calibrated-selective-prediction"} else None
    except RuntimeError as exc: raise HTTPException(status_code=409, detail=str(exc)) from exc
    if existing: return existing
    now = datetime.now(timezone.utc); artifact_decision = artifact_manifest = temporal_decision = temporal_manifest = capability_decision = capability_manifest = capability_artifacts = risk_artifacts = journal_artifacts = equivalence_artifacts = venue_price_artifacts = None
    collateral_artifacts = termination_artifacts = communication_artifacts = quorum_artifacts = qualification_artifacts = mandate_policy_artifacts = authority_artifacts = consent_artifacts = usage_rights_artifacts = eligibility_artifacts = contestation_artifacts = portability_artifacts = evidence_event_artifacts = schedule_sync_artifacts = assurance_artifacts = claim_disagreement_artifacts = source_value_artifacts = evidence_integrity_artifacts = portfolio_sizing_artifacts = execution_quality_artifacts = shadow_tca_artifacts = run_planning_artifacts = decision_memory_artifacts = promotion_artifacts = selective_prediction_artifacts = analytical_diversity_artifacts = None
    run_hash = canonical_hash({"operator": operator, "featureId": body.feature_id, "idempotencyKey": body.idempotency_key, "requestHash": body.request_hash})
    try:
        if body.feature_id == "operational-secret-custody":
            from .operational_secret_scenarios import evaluate_vault_fixture, scenario_registry
            fixture = next((item for item in scenario_registry() if item["id"] == body.scenario_id), None)
            if not fixture: raise ValueError("Unknown checked-in operational secret scenario")
            result = await evaluate_vault_fixture(fixture, controls["effectiveMode"], now,
                operator, run_hash, OperationalSecretRepository(request.app.state.repository.engine),
                "test" if settings.environment.lower() == "test" else "local")
            result = sanitize_artifact(result)
        elif body.feature_id == "execution-artifact-certification":
            from .execution_artifact_scenarios import evaluate_fixture
            result = evaluate_fixture(body.scenario_id, controls["effectiveMode"], now,
                operator, run_hash)
            artifact_decision = result.pop("_decision")
            artifact_manifest = result.pop("_inputManifest")
        elif body.feature_id == "temporal-integrity":
            from .temporal_integrity_scenarios import evaluate_fixture
            result = evaluate_fixture(body.scenario_id, controls["effectiveMode"], now, operator, run_hash)
            temporal_decision = result.pop("_decision")
            temporal_manifest = result.pop("_inputManifest")
        elif body.feature_id == "capability-delegation-lifecycle":
            from .capability_delegation_scenarios import evaluate_fixture
            result = evaluate_fixture(body.scenario_id, controls["effectiveMode"], now, operator, run_hash)
            capability_decision = result.pop("_decision")
            capability_manifest = result.pop("_inputManifest")
            capability_artifacts = (result.pop("_grants"), result.pop("_observations"), result.pop("_transitions"))
        elif body.feature_id == "authoritative-risk-snapshot-and-reconciliation":
            from .risk_reconciliation_scenarios import evaluate_fixture
            result = evaluate_fixture(body.scenario_id, controls["effectiveMode"], now, operator, run_hash,
                controls["frozenPrerequisiteHash"])
            risk_artifacts = (result.pop("_observations"), result.pop("_manifest"), result.pop("_snapshot"),
                result.pop("_reservation"), result.pop("_attempt"), result.pop("_reconciliation"))
        elif body.feature_id == "asset-conservation-journal":
            from .asset_journal_scenarios import evaluate_fixture
            result = evaluate_fixture(body.scenario_id, controls["effectiveMode"], now, operator, run_hash,
                controls["frozenPrerequisiteHash"])
            journal_artifacts = (result.pop("_units"), result.pop("_accounts"), result.pop("_events"), result.pop("_manifest"),
                result.pop("_candidates"), result.pop("_check"), result.pop("_receipt"))
        elif body.feature_id == "intent-execution-equivalence":
            from .intent_equivalence_scenarios import evaluate_fixture
            result = evaluate_fixture(body.scenario_id, controls["effectiveMode"], now, operator, run_hash,
                controls["frozenPrerequisiteHash"])
            equivalence_artifacts = dict(result)
        elif body.feature_id == "venue-price-liquidation-safety":
            from .venue_price_scenarios import evaluate_fixture
            result = evaluate_fixture(body.scenario_id, controls["effectiveMode"], now, operator, run_hash,
                controls["frozenPrerequisiteHash"])
            venue_price_artifacts = dict(result)
        elif body.feature_id == "collateral-resilience-exit-capacity":
            from .collateral_resilience_scenarios import evaluate_fixture
            result = evaluate_fixture(body.scenario_id, controls["effectiveMode"], now, operator, run_hash,
                controls["frozenPrerequisiteHash"])
            collateral_artifacts = dict(result)
        elif body.feature_id == "verified-strategy-termination":
            from .strategy_termination_test_center_adapter import evaluate
            prerequisites = await StrategyTerminationRepository(request.app.state.repository.engine).selected_prerequisites(operator, selected_ids or {})
            result = evaluate(body.scenario_id, controls["effectiveMode"], now, operator, run_hash,
                controls["frozenPrerequisiteHash"], prerequisites)
            termination_artifacts = dict(result)
        elif body.feature_id == "incident-communication-outbox":
            from .test_center_feature_runs import evaluate_incident_communication
            result = await evaluate_incident_communication(body.scenario_id, controls["effectiveMode"], now, operator, run_hash)
            communication_artifacts = dict(result)
        elif body.feature_id == "safety-change-quorum":
            from .test_center_feature_runs import evaluate_safety_change_quorum
            result = await evaluate_safety_change_quorum(body.scenario_id, controls["effectiveMode"], now, operator, run_hash)
            quorum_artifacts = dict(result)
        elif body.feature_id == "operator-qualification":
            from .test_center_feature_runs import evaluate_operator_qualification
            result = await evaluate_operator_qualification(body.scenario_id, controls["effectiveMode"], now, operator, run_hash)
            qualification_artifacts = result.pop("_artifacts")
        elif body.feature_id == "mandate-policy-semantic-fidelity":
            from .test_center_mandate_policy import evaluate_mandate_policy
            result = await evaluate_mandate_policy(body.scenario_id, controls["effectiveMode"], now, operator, run_hash)
            mandate_policy_artifacts = result.pop("_artifacts", None)
        elif body.feature_id == "effective-authority-decision":
            from .test_center_run_dispatch import evaluate_effective_authority
            result, authority_artifacts = evaluate_effective_authority(body.scenario_id, controls["effectiveMode"], now, operator, run_hash)
        elif body.feature_id == "risk-tiered-approval-consent":
            from .test_center_risk_tiered_consent import evaluate_consent
            result, consent_artifacts = evaluate_consent(body.scenario_id, controls["effectiveMode"], now, operator, run_hash)
            consent_artifacts["feature19_context"] = feature19_context
        elif body.feature_id == "external-usage-rights":
            result = __import__("moeazi_agent.usage_rights_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash); usage_rights_artifacts = result.pop("_artifacts"); result["selectedPrerequisiteStatus"] = usage_rights_context["status"]
        elif body.feature_id == "external-product-eligibility": result=__import__("moeazi_agent.product_eligibility_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash); eligibility_artifacts=result.pop("_artifacts"); result["selectedPrerequisiteStatus"]=eligibility_context["status"]
        elif body.feature_id == "customer-contestation":
            result=__import__("moeazi_agent.customer_contestation_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash); contestation_artifacts=result.pop("_artifacts"); result["selectedPrerequisiteStatus"]=contestation_context["status"]
        elif body.feature_id == "customer-account-portability": result=__import__("moeazi_agent.portability_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash); portability_artifacts=result.pop("_artifacts"); result["selectedPrerequisiteStatus"]=portability_context["status"]
        elif body.feature_id == "evidence-event-fabric": result=__import__("moeazi_agent.evidence_event_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash,evidence_event_context,controls); evidence_event_artifacts=result.pop("_artifacts")
        elif body.feature_id == "schedule-sync-outbox": result=__import__("moeazi_agent.schedule_sync_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash,controls); schedule_sync_artifacts=result.pop("_artifacts")
        elif body.feature_id == "system-safety-assurance-corpus": result=__import__("moeazi_agent.safety_assurance_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash,controls); assurance_artifacts=result.pop("_artifacts")
        elif body.feature_id == "claim-disagreement-ledger": result=__import__("moeazi_agent.claim_disagreement_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash,claim_disagreement_context,controls); claim_disagreement_artifacts=result.pop("_artifacts")
        elif body.feature_id == "specialist-source-value-attribution": result=__import__("moeazi_agent.source_value_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash,source_value_context,controls); source_value_artifacts=result.pop("_artifacts")
        elif body.feature_id == "manipulation-aware-evidence-integrity": result=__import__("moeazi_agent.evidence_integrity_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash,evidence_integrity_context,controls); evidence_integrity_artifacts=result.pop("_artifacts")
        elif body.feature_id == "portfolio-aware-sizing": result=__import__("moeazi_agent.portfolio_sizing_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash,portfolio_sizing_context,controls); portfolio_sizing_artifacts=result.pop("_artifacts")
        elif body.feature_id == "multi-venue-execution-quality-routing": result=__import__("moeazi_agent.execution_quality_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash,execution_quality_context,controls); execution_quality_artifacts=result.pop("_artifacts")
        elif body.feature_id == "calibrated-shadow-execution-tca": result=__import__("moeazi_agent.shadow_tca_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash,shadow_tca_context,controls); shadow_tca_artifacts=result.pop("_artifacts")
        elif body.feature_id == "deterministic-run-planning": result=__import__("moeazi_agent.run_planning_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash,run_planning_context,controls); run_planning_artifacts=result.pop("_artifacts")
        elif body.feature_id == "outcome-linked-decision-memory": result=__import__("moeazi_agent.decision_memory_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash,decision_memory_context,controls); decision_memory_artifacts=result.pop("_artifacts")
        elif body.feature_id == "outcome-calibrated-promotion": result=__import__("moeazi_agent.promotion_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash,promotion_context,controls); promotion_artifacts=result.pop("_artifacts")
        elif body.feature_id == "calibrated-selective-prediction": result=__import__("moeazi_agent.selective_prediction_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash,selective_prediction_context,controls); selective_prediction_artifacts=result.pop("_artifacts")
        elif body.feature_id == "analytical-diversity-audit": result=__import__("moeazi_agent.analytical_diversity_test_center_adapter",fromlist=["evaluate"]).evaluate(body.scenario_id,controls["effectiveMode"],now,operator,run_hash,analytical_diversity_context,controls); analytical_diversity_artifacts=result.pop("_artifacts")
        else:
            result = run_fixture(body.scenario_id, controls["effectiveMode"], now,
                body.feature_id, body.control_hash)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    recovery_artifacts = result.pop("_storageArtifacts", [])
    meta = registry_response()
    layer_events = {"capture": "fixture_captured", "evaluate": "invariants_evaluated",
        "project": "result_projected", "enforce": "enforcement_simulated"}
    events = [{"sequence": 1, "eventType": "run_frozen", "status": "complete"}]
    for layer in controls["layers"]:
        events.append({"sequence": len(events) + 1, "eventType": layer_events[layer],
            "status": result["invariantVerdict"] if layer == "evaluate" else "complete"})
    audit = audit_snapshot(body.feature_id)
    if equivalence_artifacts:
        result = {key: value for key, value in result.items() if not key.startswith("_")}
    if venue_price_artifacts:
        result = {key: value for key, value in result.items() if not key.startswith("_")}
    if collateral_artifacts:
        result = {key: value for key, value in result.items() if not key.startswith("_")}
    if termination_artifacts:
        result = {key: value for key, value in result.items() if not key.startswith("_")}
    if communication_artifacts: result = {key: value for key, value in result.items() if not key.startswith("_")}
    if quorum_artifacts: result = {key: value for key, value in result.items() if not key.startswith("_")}
    if qualification_artifacts: result = {key: value for key, value in result.items() if not key.startswith("_")}
    if mandate_policy_artifacts: result = {key: value for key, value in result.items() if not key.startswith("_")}
    if decision_memory_artifacts: result = {key: value for key, value in result.items() if not key.startswith("_")}
    if promotion_artifacts: result = {key: value for key, value in result.items() if not key.startswith("_")}
    if selective_prediction_artifacts: result = {key: value for key, value in result.items() if not key.startswith("_")}
    if analytical_diversity_artifacts: result = {key: value for key, value in result.items() if not key.startswith("_")}
    payload = {
        "runId": f"run-{run_hash[:32]}", "operatorTestId": operator,
        "featureId": body.feature_id,
        "scenarioId": body.scenario_id, "mode": controls["effectiveMode"],
        "repositorySha": settings.test_center_repository_sha,
        "registryVersion": meta["registryVersion"], "registryHash": meta["registryHash"],
        "controlHash": body.control_hash, "fixtureHash": result["fixtureHash"],
        "safeEnvironment": "test" if settings.environment.lower() == "test" else "local",
        "invariantVerdict": result["invariantVerdict"], "result": result,
        "idempotencyKey": body.idempotency_key, "requestHash": body.request_hash,
        "manualGuard": True, "liteMode": True,
        "prerequisiteBindings": controls["frozenPrerequisiteBindings"],
        "prerequisiteClosureHash": controls["frozenPrerequisiteHash"],
        "auditSnapshot": audit, "auditSnapshotHash": canonical_hash(audit),
        "events": events,
    }
    if artifact_manifest:
        payload["frozenInputManifest"] = artifact_manifest.model_dump(mode="json")
        payload["frozenInputManifestHash"] = artifact_manifest.manifest_hash
    if temporal_manifest:
        payload["frozenInputManifest"] = temporal_manifest.model_dump(mode="json")
        payload["frozenInputManifestHash"] = temporal_manifest.manifest_hash
    if capability_manifest:
        payload["frozenInputManifest"] = capability_manifest.model_dump(mode="json")
        payload["frozenInputManifestHash"] = capability_manifest.manifest_hash
    if risk_artifacts:
        payload["frozenInputManifest"] = risk_artifacts[1].model_dump(mode="json")
        payload["frozenInputManifestHash"] = risk_artifacts[1].manifest_hash
    if journal_artifacts:
        payload["frozenInputManifest"] = journal_artifacts[3].model_dump(mode="json")
        payload["frozenInputManifestHash"] = journal_artifacts[3].manifest_hash
    if equivalence_artifacts:
        payload["frozenInputManifest"] = equivalence_artifacts["_envelope"].model_dump(mode="json")
        payload["frozenInputManifestHash"] = equivalence_artifacts["_envelope"].envelope_hash
    if venue_price_artifacts:
        payload["frozenInputManifest"] = venue_price_artifacts["_decision"].model_dump(mode="json")
        payload["frozenInputManifestHash"] = venue_price_artifacts["_decision"].decision_hash
    if collateral_artifacts:
        payload["frozenInputManifest"] = collateral_artifacts["_envelope"].model_dump(mode="json")
        payload["frozenInputManifestHash"] = collateral_artifacts["_envelope"].envelope_hash
    if termination_artifacts:
        payload["frozenInputManifest"] = termination_artifacts["_snapshot"].model_dump(mode="json")
        payload["frozenInputManifestHash"] = termination_artifacts["_snapshot"].snapshot_hash
    if communication_artifacts:
        payload["frozenInputManifest"] = communication_artifacts["_revision"].model_dump(mode="json")
        payload["frozenInputManifestHash"] = communication_artifacts["_revision"].revision_hash
    if quorum_artifacts:
        payload["frozenInputManifest"] = quorum_artifacts["_request"].model_dump(mode="json")
        payload["frozenInputManifestHash"] = quorum_artifacts["_request"].request_hash
    try:
        if promotion_artifacts: return await __import__("moeazi_agent.promotion_storage",fromlist=["PromotionRepository"]).PromotionRepository(request.app.state.repository.engine).persist_bundle(payload)
        if selective_prediction_artifacts: return await __import__("moeazi_agent.selective_prediction_storage",fromlist=["SelectivePredictionRepository"]).SelectivePredictionRepository(request.app.state.repository.engine).persist_bundle(payload)
        if analytical_diversity_artifacts: return await __import__("moeazi_agent.analytical_diversity_storage",fromlist=["AnalyticalDiversityRepository"]).AnalyticalDiversityRepository(request.app.state.repository.engine).persist_bundle(payload)
        if decision_memory_artifacts: return await __import__("moeazi_agent.decision_memory_storage",fromlist=["DecisionMemoryRepository"]).DecisionMemoryRepository(request.app.state.repository.engine).persist_bundle(payload)
        if shadow_tca_artifacts: return await __import__("moeazi_agent.shadow_tca_storage",fromlist=["ShadowTcaRepository"]).ShadowTcaRepository(request.app.state.repository.engine).persist_bundle(operator,body.idempotency_key,body.request_hash,{**shadow_tca_artifacts,"registryHash":result["registryHash"]},payload)
        if execution_quality_artifacts: return await __import__("moeazi_agent.execution_quality_storage",fromlist=["ExecutionQualityRepository"]).ExecutionQualityRepository(request.app.state.repository.engine).persist_bundle(operator,body.idempotency_key,body.request_hash,{**execution_quality_artifacts,"registryHash":result["registryHash"]},payload)
        if portfolio_sizing_artifacts: return await __import__("moeazi_agent.portfolio_sizing_storage",fromlist=["PortfolioSizingRepository"]).PortfolioSizingRepository(request.app.state.repository.engine).persist_bundle(operator,body.idempotency_key,body.request_hash,{**portfolio_sizing_artifacts,"registryHash":result["registryHash"]},payload)
        if evidence_integrity_artifacts: return await __import__("moeazi_agent.evidence_integrity_storage",fromlist=["EvidenceIntegrityRepository"]).EvidenceIntegrityRepository(request.app.state.repository.engine).persist_bundle(operator,body.idempotency_key,body.request_hash,{**evidence_integrity_artifacts,"registryHash":result["registryHash"]},payload)
        if source_value_artifacts: return await __import__("moeazi_agent.source_value_storage",fromlist=["SourceValueRepository"]).SourceValueRepository(request.app.state.repository.engine).persist_bundle(operator,body.idempotency_key,body.request_hash,source_value_artifacts,payload)
        if claim_disagreement_artifacts: return await __import__("moeazi_agent.claim_disagreement_storage",fromlist=["ClaimLedgerRepository"]).ClaimLedgerRepository(request.app.state.repository.engine).persist_bundle(operator,body.idempotency_key,body.request_hash,claim_disagreement_artifacts,payload)
        if assurance_artifacts: return await __import__("moeazi_agent.safety_assurance_storage",fromlist=["AssuranceRepository"]).AssuranceRepository(request.app.state.repository.engine).persist_bundle(operator,body.idempotency_key,body.request_hash,assurance_artifacts,payload)
        if schedule_sync_artifacts: return await __import__("moeazi_agent.schedule_sync_storage",fromlist=["ScheduleSyncRepository"]).ScheduleSyncRepository(request.app.state.repository.engine).persist_bundle(operator,body.idempotency_key,body.request_hash,schedule_sync_artifacts,payload)
        if evidence_event_artifacts: return await __import__("moeazi_agent.evidence_event_storage",fromlist=["EvidenceEventRepository"]).EvidenceEventRepository(request.app.state.repository.engine).persist_bundle(operator,body.idempotency_key,body.request_hash,evidence_event_artifacts,payload)
        if portability_artifacts: return await __import__("moeazi_agent.test_center_portability",fromlist=["persist_portability"]).persist_portability(request.app.state.repository.engine,operator,body.idempotency_key,body.request_hash,portability_artifacts,payload)
        if contestation_artifacts: return await __import__("moeazi_agent.test_center_customer_contestation",fromlist=["persist_customer_contestation"]).persist_customer_contestation(request.app.state.repository.engine,operator,body.idempotency_key,body.request_hash,contestation_artifacts,payload)
        if eligibility_artifacts: return await __import__("moeazi_agent.test_center_product_eligibility",fromlist=["persist_product_eligibility"]).persist_product_eligibility(request.app.state.repository.engine,operator,body.idempotency_key,body.request_hash,eligibility_artifacts,payload)
        if usage_rights_artifacts: return await __import__("moeazi_agent.test_center_usage_rights",fromlist=["persist_usage_rights"]).persist_usage_rights(request.app.state.repository.engine,operator,body.idempotency_key,body.request_hash,usage_rights_artifacts,payload)
        if artifact_decision:
            from .execution_artifact_storage import ExecutionArtifactRepository
            return await ExecutionArtifactRepository(request.app.state.repository.engine).persist_bundle(
                artifact_decision, artifact_manifest, payload)
        if temporal_decision:
            from .temporal_integrity_storage import TemporalIntegrityRepository
            return await TemporalIntegrityRepository(request.app.state.repository.engine).persist_bundle(
                temporal_decision, temporal_manifest, payload)
        if capability_decision:
            from .capability_delegation_storage import CapabilityDelegationRepository
            grants, observations, transitions = capability_artifacts
            return await CapabilityDelegationRepository(request.app.state.repository.engine).persist_bundle(
                grants, observations, transitions, capability_manifest, capability_decision, payload)
        if risk_artifacts:
            from .risk_reconciliation_storage import RiskReconciliationRepository
            return await RiskReconciliationRepository(request.app.state.repository.engine).persist_bundle(
                *risk_artifacts, payload)
        if journal_artifacts:
            from .asset_journal_storage import AssetJournalRepository
            return await AssetJournalRepository(request.app.state.repository.engine).persist_bundle(*journal_artifacts, payload)
        if equivalence_artifacts:
            from .intent_equivalence_storage import IntentEquivalenceRepository
            return await IntentEquivalenceRepository(request.app.state.repository.engine).persist_bundle(equivalence_artifacts, payload)
        if venue_price_artifacts:
            from .venue_price_storage import VenuePriceRepository
            return await VenuePriceRepository(request.app.state.repository.engine).persist_bundle(venue_price_artifacts, payload)
        if collateral_artifacts:
            from .collateral_resilience_storage import CollateralResilienceRepository
            return await CollateralResilienceRepository(request.app.state.repository.engine).persist_bundle(collateral_artifacts, payload)
        if termination_artifacts:
            from .strategy_termination_storage import StrategyTerminationRepository
            return await StrategyTerminationRepository(request.app.state.repository.engine).persist_bundle(termination_artifacts, payload)
        if communication_artifacts:
            return await IncidentCommunicationRepository(request.app.state.repository.engine).persist_bundle(communication_artifacts, payload)
        if quorum_artifacts:
            return await SafetyChangeQuorumRepository(request.app.state.repository.engine).persist_bundle(quorum_artifacts, payload)
        if qualification_artifacts:
            from .operator_qualification_storage import OperatorQualificationRepository
            return await OperatorQualificationRepository(request.app.state.repository.engine).persist_bundle(qualification_artifacts, payload)
        if mandate_policy_artifacts:
            from .test_center_mandate_policy import persist_mandate_policy
            return await persist_mandate_policy(request.app.state.repository.engine,operator,mandate_policy_artifacts,payload)
        if authority_artifacts:
            from .test_center_run_dispatch import persist_effective_authority
            return await persist_effective_authority(request.app.state.repository.engine,operator,body.idempotency_key,body.request_hash,authority_artifacts,payload)
        if consent_artifacts:
            from .test_center_risk_tiered_consent import persist_consent
            return await persist_consent(request.app.state.repository.engine,operator,body.idempotency_key,body.request_hash,consent_artifacts,payload)
        if body.feature_id == "cross-state-recovery-continuity":
            artifacts = [{**item, "scopeKey": result["tenantKey"], "producedAt": now}
                for item in recovery_artifacts]
            transitions = transition_rows(result["stateTransitions"],
                [item["canonicalHash"] for item in artifacts], now)
            return await RecoveryRepository(request.app.state.repository.engine).save_bundle(
                payload, artifacts, transitions)
        return await repository(request).save_run(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
@router.get("/runs/{run_id}")
async def get_run(run_id: str, request: Request, authorization: str | None = Header(default=None), subject: str | None = Header(default=None, alias="X-Moeazi-Subject"), session_id: str | None = Header(default=None, alias="X-Moeazi-Session-Id")):
    operator = authorize(authorization, subject, session_id); result = await repository(request).get_run(run_id, operator)
    if not result: raise HTTPException(status_code=404, detail="Test Center run not found")
    return public_run_response(result)
@router.get("/runs/{run_id}/events")
async def run_events(run_id: str, request: Request, authorization: str | None = Header(default=None), subject: str | None = Header(default=None, alias="X-Moeazi-Subject"), session_id: str | None = Header(default=None, alias="X-Moeazi-Session-Id")):
    operator = authorize(authorization, subject, session_id)
    if not re.fullmatch(r"run-[a-f0-9]{32}", run_id):
        raise HTTPException(status_code=400, detail="Invalid Test Center run ID")
    events = await repository(request).events(run_id, operator)
    if not events:
        raise HTTPException(status_code=404, detail="Test Center run not found")
    async def stream():
        for event in events:
            yield f"id: {event['sequence']}\nevent: {event['eventType']}\ndata: {json.dumps(event, sort_keys=True)}\n\n"
        yield "event: complete\ndata: {\"status\":\"complete\"}\n\n"
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control":"no-cache, no-transform","X-Accel-Buffering":"no"})
