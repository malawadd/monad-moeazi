from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
import json

from .evidence_lifecycle_contracts import (
    LifecycleScope, PersistenceDecision, RetentionSchedule,
)
from .evidence_lifecycle_evaluator import evaluate_persistence
from .evidence_lifecycle_storage import EvidenceLifecycleRepository
from .evidence_lifecycle_identity import evaluation_owner_scope_key
from .evaluation_lifecycle_disclosure import admitted_archive_body, archive_content


class EvaluationLifecycleGate:
    """Persisted, fail-closed admission for every Evaluation Lab model request."""

    def __init__(self, engine, run_id: str, market: str,
            observed_at: datetime | None = None, account_id: str | None = None,
            operator_subject: str | None = None, *,
            provider_observed_at: datetime | None = None,
            dispatch_clock: Callable[[], datetime] | None = None):
        self.repository = EvidenceLifecycleRepository(engine)
        self.run_id = run_id
        self.market = market.upper()
        self.observed_at = observed_at or datetime.now(timezone.utc)
        self.provider_observed_at = provider_observed_at or self.observed_at
        self.dispatch_clock = dispatch_clock or (lambda: datetime.now(timezone.utc))
        self.provider_decisions: dict[str, PersistenceDecision] = {}
        self.provider_schedules: dict[str, RetentionSchedule] = {}
        if account_id:
            self.scope = LifecycleScope(kind="account", key=f"account:{account_id}",
                strategy_account_id=account_id)
        elif operator_subject:
            scope_key = evaluation_owner_scope_key(operator_subject)
            tenant_id = scope_key.removeprefix("tenant:")
            self.scope = LifecycleScope(kind="tenant", key=scope_key,
                tenant_id=tenant_id)
        else:
            self.scope = LifecycleScope(kind="public", key="public")

    async def __call__(self, stage: str, content: str,
            evidence_ids: list[str]) -> str:
        decision, sanitized, receipts, schedule = evaluate_persistence(
            producer="provider_prompt", purpose="evaluation",
            sink="provider.model_request", scope=self.scope,
            payload={"request_id": f"{self.run_id}:{stage}", "market": self.market,
                "content": content, "evidence_ids": sorted(set(evidence_ids))},
            artifact_id=f"{self.run_id}:{stage}",
            idempotency_key=f"evaluation:{self.run_id}:{stage}",
            observed_at=self.provider_observed_at)
        await self.repository.save_decision_bundle(decision, receipts, schedule)
        if decision.outcome not in {"allow", "transformed"}:
            raise RuntimeError(f"Evidence lifecycle blocks evaluation request: {decision.reasons[0]}")
        if not schedule:
            raise RuntimeError("Evaluation provider retention binding is missing")
        self.provider_decisions[stage] = decision
        self.provider_schedules[stage] = schedule
        return str(sanitized["content"])

    async def verify_dispatch(self, stage: str) -> None:
        """Reload exact persisted authority immediately before provider dispatch."""
        decision = self.provider_decisions[stage] if stage in self.provider_decisions else None
        schedule = self.provider_schedules[stage] if stage in self.provider_schedules else None
        if not decision or not schedule or decision.scope.key != self.scope.key:
            raise RuntimeError("Evaluation provider lifecycle decision is missing")
        await self.repository.verify_provider_dispatch(
            decision, schedule, self.dispatch_clock())

    async def govern_case(self, case: dict) -> tuple[PersistenceDecision, dict]:
        """Persist a first-class case admission before any case body or model call."""
        allowed = {"case_id", "experiment_id", "market", "case_kind", "repetition",
            "market_snapshot", "evidence_snapshot", "snapshot_hash", "observed_at", "status"}
        if set(case) != allowed:
            raise ValueError("Evaluation case must use the complete frozen contract")
        decision, admitted, receipts, schedule = evaluate_persistence(
            producer="evaluation_case", purpose="evaluation",
            sink="timescale.evaluation_case", scope=self.scope, payload=case,
            artifact_id=str(case["case_id"]),
            idempotency_key=f"evaluation-case:{case['case_id']}",
            observed_at=self.observed_at)
        await self.repository.save_decision_bundle(decision, receipts, schedule)
        if decision.outcome not in {"allow", "transformed"}:
            raise RuntimeError(f"Evidence lifecycle blocks evaluation case: {decision.reasons[0]}")
        return decision, admitted

    async def archive(self, case_id: str, run: dict) -> tuple[str, dict]:
        body = admitted_archive_body(run)
        content = archive_content(body)
        decision, sanitized, receipts, schedule = evaluate_persistence(
            producer="evaluation_archive", purpose="evaluation",
            sink="timescale.analysis_body", scope=self.scope,
            payload={"case_id": case_id, "run_id": self.run_id,
                "content": content, "status": str(run.get("status", "unknown"))},
            artifact_id=self.run_id, idempotency_key=f"evaluation-archive:{self.run_id}",
            observed_at=self.observed_at)
        await self.repository.save_decision_bundle(decision, receipts, schedule)
        if decision.outcome not in {"allow", "transformed"}:
            raise RuntimeError(f"Evidence lifecycle blocks evaluation archive: {decision.reasons[0]}")
        admitted = json.loads(str(sanitized["content"]))
        if not isinstance(admitted, dict):
            raise RuntimeError("Evidence lifecycle evaluation archive is not an object")
        admitted["lifecycle_decision_hash"] = decision.decision_hash
        return decision.decision_hash, admitted
