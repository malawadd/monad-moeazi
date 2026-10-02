from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone

from .evidence_lifecycle_contracts import (
    LifecycleScope, PersistenceDecision, RetentionSchedule,
)
from .evidence_lifecycle_evaluator import evaluate_persistence
from .evidence_lifecycle_storage import EvidenceLifecycleRepository


class AnalysisProviderLifecycleGate:
    """Frozen admission plus current persisted verification for analysis providers."""

    def __init__(self, engine, scope: LifecycleScope, job_id: str, market: str,
            observed_at: datetime, *, clock: Callable[[], datetime] | None = None):
        self.repository = EvidenceLifecycleRepository(engine)
        self.scope = scope
        self.job_id = job_id
        self.market = market.upper()
        self.observed_at = observed_at
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.decisions: dict[str, PersistenceDecision] = {}
        self.schedules: dict[str, RetentionSchedule] = {}

    async def __call__(self, stage: str, content: str, evidence_ids: list[str]) -> str:
        artifact = f"{self.job_id}:{stage}"
        decision, sanitized, receipts, schedule = evaluate_persistence(
            producer="provider_prompt", purpose="agent_analysis",
            sink="provider.model_request", scope=self.scope,
            payload={"request_id": artifact, "market": self.market,
                "content": content, "evidence_ids": sorted(evidence_ids)},
            artifact_id=artifact, idempotency_key=f"provider:{self.job_id}:{stage}",
            observed_at=self.observed_at)
        await self.repository.save_decision_bundle(decision, receipts, schedule)
        if decision.outcome not in {"allow", "transformed"}:
            raise RuntimeError(
                f"Evidence lifecycle blocks provider request: {decision.reasons[0]}")
        if not schedule:
            raise RuntimeError("Provider lifecycle retention binding is missing")
        self.decisions[stage] = decision
        self.schedules[stage] = schedule
        return str(sanitized["content"])

    async def verify_dispatch(self, stage: str) -> None:
        decision = self.decisions[stage] if stage in self.decisions else None
        schedule = self.schedules[stage] if stage in self.schedules else None
        if not decision or not schedule:
            raise RuntimeError("Provider lifecycle decision is missing")
        await self.repository.verify_provider_dispatch(
            decision, schedule, self.clock())
