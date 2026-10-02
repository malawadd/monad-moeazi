from __future__ import annotations

from datetime import datetime, timedelta, timezone

from temporalio import activity, workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from temporalio.exceptions import WorkflowAlreadyStartedError
    from .config import get_settings
    from .convex import ConvexWorkerClient
    from .evidence_lifecycle_storage import EvidenceLifecycleRepository
    from .evidence_lifecycle_deletion import LifecycleCommand
    from .evidence_lifecycle_identity import canonical_lifecycle_scope_key
    from .storage import AnalysisRepository


@activity.defn
async def expire_evidence_body_activity(payload: dict) -> dict:
    allowed = {"artifact_id", "scope_key", "schedule_hash", "due_at"}
    if set(payload) != allowed or len(str(payload["schedule_hash"])) != 64:
        raise ValueError("Lifecycle expiry accepts only frozen identifiers")
    due_at = datetime.fromisoformat(str(payload["due_at"]).replace("Z", "+00:00"))
    scope_key = canonical_lifecycle_scope_key(str(payload["scope_key"]))
    if due_at.tzinfo is None or due_at.utcoffset() != timedelta(0):
        raise ValueError("Lifecycle expiry due time must be UTC")
    settings = get_settings()
    repository = AnalysisRepository(settings.postgres_dsn)
    lifecycle = EvidenceLifecycleRepository(repository.engine)
    disposition = await lifecycle.dispose_artifact(
        str(payload["artifact_id"]), due_at, schedule_hash=str(payload["schedule_hash"]),
        scope_key=scope_key)
    account_id = await lifecycle.artifact_account(str(payload["artifact_id"]), scope_key)
    if disposition.get("deleted") and account_id:
        state = {"verified": "deleted", "partial": "partial",
            "unverifiable": "unverifiable"}.get(disposition["outcome"], "partial")
        await ConvexWorkerClient(settings).command("projectEvidenceLifecycleStatus",
            strategyAccountId=account_id, artifactId=str(payload["artifact_id"]),
            scopeKey=f"account:{account_id}", lifecycleState=state,
            expectedCopyCount=len(disposition.get("expected_copies", [])),
            resolvedCopyCount=len(disposition.get("copy_receipt_hashes", {})),
            deletionReceiptHash=disposition["receipt_hash"],
            latestDecisionHash=disposition["receipt_hash"],
            transitionHash=disposition["receipt_hash"],
            transitionAt=int(due_at.timestamp() * 1000), transitionPhase="deletion")
    return {"artifact_id": payload["artifact_id"], "scope_key": scope_key,
        "schedule_hash": payload["schedule_hash"],
        "owner_id": "timescale_history", **disposition}


@activity.defn
async def execute_copy_commands_activity(payload: dict) -> dict:
    if set(payload) != {"artifact_id", "scope_key", "schedule_hash", "observed_at"}:
        raise ValueError("Copy execution accepts only frozen identifiers")
    observed_at = datetime.fromisoformat(str(payload["observed_at"]).replace("Z", "+00:00"))
    scope_key = canonical_lifecycle_scope_key(str(payload["scope_key"]))
    settings = get_settings()
    repository = EvidenceLifecycleRepository(AnalysisRepository(settings.postgres_dsn).engine)
    commands = await repository.pending_copy_commands(
        str(payload["schedule_hash"]), scope_key)
    redis = None
    try:
        for row in commands:
            owner, copy_id = row["owner_id"], row["copy_id"]
            try:
                if owner == "redis_coordination" and copy_id == "redis.evidence_cache":
                    from redis.asyncio import Redis
                    command = LifecycleCommand.model_validate(row["payload"])
                    expected = await repository.evidence_cache_locator(
                        str(payload["artifact_id"]), str(payload["schedule_hash"]), scope_key)
                    if not command.locator or command.locator != expected:
                        status, reference = "unverifiable", "cache_locator_unavailable"
                    else:
                        redis = redis or Redis.from_url(settings.redis_url)
                        deleted = await redis.delete(command.locator)
                        if deleted == 1:
                            status, reference = "verified_logical", "registry_cache_key_deleted"
                        else:
                            status, reference = "unverifiable", "cache_absence_unproven"
                elif owner == "redis_coordination":
                    status, reference = "not_applicable", "notification_has_no_retained_copy"
                elif owner == "convex_product_state":
                    account = await repository.artifact_account(
                        str(payload["artifact_id"]), scope_key)
                    if account:
                        await ConvexWorkerClient(settings).command("projectEvidenceLifecycleStatus",
                            strategyAccountId=account, artifactId=str(payload["artifact_id"]),
                            scopeKey=f"account:{account}", lifecycleState="partial",
                            expectedCopyCount=1, resolvedCopyCount=1,
                            latestDecisionHash=row["command_hash"],
                            transitionHash=row["command_hash"],
                            transitionAt=int(observed_at.timestamp() * 1000),
                            transitionPhase="copy_disposition")
                        status, reference = "verified_logical", "conservative_projection_committed"
                    else:
                        status, reference = "unverifiable", "authenticated_binding_unavailable"
                elif owner == "public_onchain":
                    status, reference = "public_onchain", "immutable_public_copy"
                elif owner == "timescale_history" and copy_id == "timescale.lifecycle_receipt":
                    status, reference = "not_applicable", "minimal_safety_root_retained"
                else:
                    status, reference = "unverifiable", f"{owner}_adapter_not_activated"
                await repository.complete_copy_command(row["command_hash"], status,
                    observed_at, reference, scope_key)
            except Exception:
                exhausted = await repository.fail_copy_command(row["command_hash"],
                    observed_at, "owner_adapter_unavailable", scope_key)
                if exhausted:
                    await repository.complete_copy_command(row["command_hash"],
                        "unverifiable", observed_at, "bounded_retries_exhausted", scope_key)
                else:
                    raise
    finally:
        if redis:
            await redis.aclose()
    aggregate = await repository.aggregate_schedule(str(payload["artifact_id"]),
        str(payload["schedule_hash"]), observed_at, scope_key)
    if aggregate["outcome"] == "partial":
        raise RuntimeError("Copy owner commands remain pending")
    return aggregate


@activity.defn
async def fetch_lifecycle_outbox_activity() -> list[dict]:
    repository = AnalysisRepository(get_settings().postgres_dsn)
    rows = await EvidenceLifecycleRepository(repository.engine).pending_outbox()
    return [{"artifact_id": row["artifact_id"], "schedule_hash": row["schedule_hash"],
        "scope_key": row["scope_key"], "due_at": row["due_at"].isoformat(),
        "expected_copies": row["expected_copies"]}
        for row in rows]


@activity.defn
async def mark_lifecycle_outbox_activity(payload: dict) -> None:
    if set(payload) != {"schedule_hash", "scope_key", "success"}:
        raise ValueError("Lifecycle outbox acknowledgement is invalid")
    repository = AnalysisRepository(get_settings().postgres_dsn)
    await EvidenceLifecycleRepository(repository.engine).mark_outbox(
        str(payload["schedule_hash"]),
        canonical_lifecycle_scope_key(str(payload["scope_key"])), bool(payload["success"]))


@activity.defn
async def fetch_hold_expiries_activity() -> list[dict]:
    repository = AnalysisRepository(get_settings().postgres_dsn)
    rows = await EvidenceLifecycleRepository(repository.engine).pending_hold_expiries()
    return [{**row, "due_at": row["due_at"].isoformat()} for row in rows]


@activity.defn
async def expire_hold_activity(payload: dict) -> dict | None:
    if set(payload) != {"hold_hash", "artifact_id", "scope_key", "due_at", "revision"}:
        raise ValueError("Hold expiry accepts only frozen outbox fields")
    due_at = datetime.fromisoformat(str(payload["due_at"]).replace("Z", "+00:00"))
    settings = get_settings()
    repository = AnalysisRepository(settings.postgres_dsn)
    lifecycle = EvidenceLifecycleRepository(repository.engine)
    transition = await lifecycle.prepare_hold_expiry(
        str(payload["hold_hash"]), str(payload["scope_key"]), due_at)
    if not transition:
        return None
    try:
        if transition["state"] != "superseded" \
                and str(payload["scope_key"]).startswith("account:"):
            account_id = str(payload["scope_key"]).removeprefix("account:")
            await ConvexWorkerClient(settings).command("projectEvidenceLifecycleStatus",
                strategyAccountId=account_id, artifactId=str(payload["artifact_id"]),
                scopeKey=str(payload["scope_key"]), lifecycleState="partial",
                expectedCopyCount=1, resolvedCopyCount=0,
                holdRevision=int(transition["hold_revision"]),
                latestDecisionHash=transition["transition_hash"],
                transitionHash=transition["transition_hash"],
                transitionAt=int(due_at.timestamp() * 1000),
                transitionPhase="hold_expired")
        await lifecycle.ack_hold_expiry(str(payload["hold_hash"]), str(payload["scope_key"]),
            transition["transition_hash"], due_at)
    except Exception:
        await lifecycle.nack_hold_expiry(str(payload["hold_hash"]), str(payload["scope_key"]),
            transition["transition_hash"], due_at, "projection_failed")
        raise
    return transition


@workflow.defn
class EvidenceLifecycleWorkflow:
    @workflow.run
    async def run(self, payload: dict) -> dict:
        allowed = {"artifact_id", "scope_key", "schedule_hash", "due_at", "expected_copies"}
        if set(payload) != allowed or not isinstance(payload["expected_copies"], list) \
                or len(payload["expected_copies"]) > 12:
            raise ValueError("Lifecycle workflow input must be a bounded frozen schedule")
        due_at = datetime.fromisoformat(str(payload["due_at"]).replace("Z", "+00:00"))
        if due_at.tzinfo is None or due_at.utcoffset() != timedelta(0):
            raise ValueError("Lifecycle workflow due time must be UTC")
        delay = max(timedelta(0), due_at - workflow.now())
        if delay: await workflow.sleep(delay)
        result = await workflow.execute_activity(expire_evidence_body_activity, {
            "artifact_id": payload["artifact_id"], "scope_key": payload["scope_key"],
            "schedule_hash": payload["schedule_hash"],
            "due_at": payload["due_at"]}, start_to_close_timeout=timedelta(minutes=1),
            retry_policy=RetryPolicy(maximum_attempts=5))
        expected = sorted(set(str(item) for item in payload["expected_copies"]))
        aggregate = await workflow.execute_activity(execute_copy_commands_activity, {
            "artifact_id": payload["artifact_id"], "scope_key": payload["scope_key"],
            "schedule_hash": payload["schedule_hash"],
            "observed_at": payload["due_at"]}, start_to_close_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(maximum_attempts=5,
                initial_interval=timedelta(seconds=10)))
        return {**result, **aggregate, "workflow_expected_copies": expected}


@workflow.defn
class EvidenceLifecycleOutboxWorkflow:
    @workflow.run
    async def run(self) -> None:
        cycles = 0
        while cycles < 100:
            rows = await workflow.execute_activity(fetch_lifecycle_outbox_activity,
                start_to_close_timeout=timedelta(minutes=1),
                retry_policy=RetryPolicy(maximum_attempts=5))
            for row in rows:
                success = True
                try:
                    await workflow.start_child_workflow(EvidenceLifecycleWorkflow.run, row,
                        id=f"evidence-lifecycle-{row['artifact_id']}-{row['schedule_hash'][:12]}")
                except WorkflowAlreadyStartedError:
                    # A crash after child start but before acknowledgement is a successful retry.
                    success = True
                except Exception:
                    success = False
                await workflow.execute_activity(mark_lifecycle_outbox_activity,
                    {"schedule_hash": row["schedule_hash"], "scope_key": row["scope_key"],
                     "success": success},
                    start_to_close_timeout=timedelta(minutes=1))
            holds = await workflow.execute_activity(fetch_hold_expiries_activity,
                start_to_close_timeout=timedelta(minutes=1),
                retry_policy=RetryPolicy(maximum_attempts=5))
            for hold in holds:
                await workflow.execute_activity(expire_hold_activity, hold,
                    start_to_close_timeout=timedelta(minutes=1),
                    retry_policy=RetryPolicy(maximum_attempts=5))
            cycles += 1
            await workflow.sleep(timedelta(seconds=10))
        workflow.continue_as_new()
