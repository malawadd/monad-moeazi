from __future__ import annotations

import json
from datetime import datetime

from pydantic import Field
from redis.asyncio import Redis
from temporalio.client import Client, WorkflowExecutionStatus
from temporalio.common import WorkflowIDReusePolicy
from temporalio.exceptions import WorkflowAlreadyStartedError
from temporalio.service import RPCError, RPCStatusCode

from .config import Settings
from .contracts import StrictModel
from .convex import ConvexWorkerClient
from .dependency_safety_contracts import (
    DependencyStatus,
    SafetyEnvelopeDecision,
    SafetyOperation,
    SafetyScope,
)
from .dependency_safety_matrix import (
    build_receipt,
    evaluate_safety,
    dependency_spec,
    incident_key,
    requirements_for,
    verify_health_receipt,
)
from .dependency_safety_storage import DependencySafetyRepository
from .dependency_incident_workflow import DependencyIncidentWorkflow
from .dependency_safety_stream import build_safety_notification


class DependencyObservation(StrictModel):
    status: DependencyStatus
    reason_code: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9_]+$")
    source_revision: str = Field(min_length=1, max_length=160)
    adapter_version: str = Field(min_length=1, max_length=80)
    evidence_reference: str | None = Field(default=None, max_length=240)
    observed_at: datetime | None = None


class DependencySafetyService:
    def __init__(self, settings: Settings, repository: DependencySafetyRepository):
        self.settings = settings
        self.repository = repository

    async def assess(
        self,
        operation: SafetyOperation,
        scope: SafetyScope,
        subject_key: str,
        observations: dict[str, DependencyObservation],
        bindings: dict[str, str],
        idempotency_key: str,
        evaluated_at: datetime,
        convex: ConvexWorkerClient,
        redis: Redis | None = None,
        request_hash: str = "",
    ) -> SafetyEnvelopeDecision:
        if not request_hash or len(request_hash) != 64:
            raise ValueError("A canonical v2 request hash is required")
        required = requirements_for(operation, bindings)
        durable = [
            item for item in await self.repository.load_current_receipts(required, scope)
            if item.schema_version == 2
        ]
        receipts = list(durable)
        new_receipts = []
        for dependency_id in required:
            observation = observations.get(dependency_id)
            existing = next((item for item in durable if item.dependency_id == dependency_id
                             and item.scope.key == scope.key), None)
            if observation is None and any(item.dependency_id == dependency_id for item in durable):
                continue
            observation = observation or DependencyObservation(
                status=DependencyStatus.UNKNOWN, reason_code="missing_authoritative_observation",
                source_revision="missing", adapter_version="dependency-safety-v2",
            )
            receipt = build_receipt(
                dependency_id=dependency_id,
                scope=scope,
                status=observation.status,
                observed_at=observation.observed_at or evaluated_at,
                reason_code=observation.reason_code,
                source_revision=observation.source_revision,
                adapter_version=observation.adapter_version,
                observation_key=f"{idempotency_key}:{dependency_id}",
                evidence_reference=observation.evidence_reference,
                supersedes_receipt_id=existing.receipt_id if existing else None,
            )
            receipts.append(receipt)
            new_receipts.append(receipt)
        for receipt in receipts:
            verify_health_receipt(receipt)
        recovery_enabled = await self._redis_available(redis)
        latched = await self._latched_incidents(convex, scope)
        decision = evaluate_safety(
            operation=operation,
            scope=scope,
            subject_key=subject_key,
            receipts=receipts,
            bindings=bindings,
            idempotency_key=idempotency_key,
            evaluated_at=evaluated_at,
            mode=self.settings.dependency_safety_mode,
            latched_incidents=latched,
            request_hash=request_hash,
        )
        await self.repository.save_bundle(new_receipts, decision, recovery_enabled=recovery_enabled)
        projection = await convex.command(
            "recordDependencySafetyBundle",
            receipts=[self._receipt_projection(item, recovery_enabled) for item in new_receipts],
            decision=self._decision_projection(decision),
        )
        await self._signal_incidents(projection.get("incidentSignals", []))
        if redis and scope.strategy_account_id:
            try:
                for signal in projection.get("incidentSignals", []):
                    await redis.set(
                        f"dependency-breaker:{signal['incidentKey']}",
                        signal["projectedState"], ex=300,
                    )
                notification = build_safety_notification(decision, projection)
                if notification is not None:
                    await redis.publish(
                        f"dependency-safety:{scope.strategy_account_id}",
                        notification.model_dump_json(),
                    )
            except Exception:
                pass
        return decision

    @staticmethod
    async def _redis_available(redis: Redis | None) -> bool:
        if redis is None:
            return False
        try:
            return bool(await redis.ping())
        except Exception:
            return False

    @staticmethod
    async def _latched_incidents(
        convex: ConvexWorkerClient,
        scope: SafetyScope,
    ) -> dict[str, str]:
        if scope.strategy_account_id:
            projection = await convex.command(
                "getDependencySafetyProjection", strategyAccountId=scope.strategy_account_id,
            )
        else:
            projection = await convex.command(
                "getDependencySafetyScopeProjection", scopeKey=scope.key,
            )
        latched: dict[str, list[str]] = {}
        # Convex is the durable current projection. A local healthy receipt, Redis
        # availability, or elapsed wall time can never release authority. Only the
        # owner projection reaching resolved after its second separated receipt can.
        for current in (projection or {}).get("incidents", []):
            if current.get("state") != "resolved":
                latched.setdefault(current["dependencyId"], []).append(current["incidentKey"])
        return latched

    async def _signal_incidents(self, signals: list[dict]) -> None:
        if not signals:
            return
        temporal = await Client.connect(
            self.settings.temporal_address, namespace=self.settings.temporal_namespace,
        )
        for signal in signals:
            workflow_id = f"dependency-incident-{signal['incidentKey']}"
            handle = temporal.get_workflow_handle(workflow_id)
            try:
                description = await handle.describe()
                if description.status is WorkflowExecutionStatus.RUNNING:
                    await handle.signal(
                        DependencyIncidentWorkflow.observe, signal,
                    )
                    continue
                if signal.get("projectedState") == "resolved":
                    continue
            except RPCError as exc:
                if exc.status is not RPCStatusCode.NOT_FOUND:
                    raise
            try:
                await temporal.start_workflow(
                    DependencyIncidentWorkflow.run, signal, id=workflow_id,
                    task_queue=self.settings.temporal_task_queue,
                    id_reuse_policy=WorkflowIDReusePolicy.ALLOW_DUPLICATE,
                )
            except WorkflowAlreadyStartedError:
                await handle.signal(
                    DependencyIncidentWorkflow.observe, signal,
                )

    @staticmethod
    def _receipt_projection(receipt, recovery_enabled: bool) -> dict:
        value = {
            "schemaVersion": receipt.schema_version,
            "receiptId": receipt.receipt_id,
            "incidentKey": incident_key(receipt.dependency_id, receipt.scope),
            "dependencyId": receipt.dependency_id,
            "failureDomain": receipt.failure_domain.value,
            "scopeKind": receipt.scope.kind,
            "scopeKey": receipt.scope.key,
            "strategyAccountId": receipt.scope.strategy_account_id,
            "status": receipt.status.value,
            "observedAt": int(receipt.observed_at.timestamp() * 1000),
            "expiresAt": int(receipt.expires_at.timestamp() * 1000),
            "reasonCode": receipt.reason_code,
            "evidenceReference": receipt.evidence_reference,
            "sourceRevision": receipt.source_revision,
            "adapterVersion": receipt.adapter_version,
            "observationKey": receipt.observation_key,
            "receiptHash": receipt.canonical_hash,
            "recoveryEligible": recovery_enabled,
            "recoveryIntervalMs": dependency_spec(receipt.dependency_id).recovery_interval_seconds * 1_000,
            "requiredHealthyObservations": dependency_spec(receipt.dependency_id).recovery_observations,
        }
        return {key: item for key, item in value.items() if item is not None}

    @staticmethod
    def _decision_projection(decision: SafetyEnvelopeDecision) -> dict:
        value = {
            "schemaVersion": decision.schema_version,
            "strategyAccountId": decision.scope.strategy_account_id,
            "operation": decision.operation.value,
            "subjectKey": decision.subject_key,
            "scopeKey": decision.scope.key,
            "mode": decision.mode,
            "breakerState": decision.breaker_state,
            "outcome": decision.outcome,
            "reasons": decision.reasons,
            "receiptHashes": decision.receipt_hashes,
            "incidentKeys": decision.incident_keys,
            "bindingsJson": json.dumps(decision.bindings, separators=(",", ":")),
            "bindingHash": decision.binding_hash,
            "requestHash": decision.request_hash,
            "decisionId": decision.decision_id,
            "decisionHash": decision.decision_hash,
            "matrixVersion": decision.matrix_version,
            "evaluatedAt": int(decision.evaluated_at.timestamp() * 1000),
            "expiresAt": int(decision.expires_at.timestamp() * 1000),
            "idempotencyKey": decision.idempotency_key,
        }
        return {key: item for key, item in value.items() if item is not None}
