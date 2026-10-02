"""Exact account reconciliation inside proof-backed reservation resolution."""
from __future__ import annotations

from collections import defaultdict

from sqlalchemy import text

from .account_observation_storage import account_snapshot_hash
from .finance_capacity import capacity_identity_conflict, held_excess
from .finance_contracts import FinanceError, FinanceScope, db_native_int, native_int
from .finance_observation_contracts import AccountObservationSnapshotRef
from .finance_oracle import journal_root
from .finance_policy import SizingPolicy


def _scope(scope: FinanceScope) -> dict:
    return {"environment": scope.environment, "scope_id": scope.scope_id,
            "strategy_account_id": scope.strategy_account_id}


async def validate_recovery_snapshot(repo, conn, scope: FinanceScope, account: dict,
                                     snapshot: AccountObservationSnapshotRef,
                                     policy: SizingPolicy, now, target_reservation_id: str) -> None:
    """Prove the post-resolution ledger and every other hold fit one fresh observation."""
    if scope.environment != "experiment" or snapshot.scope != scope \
            or account_snapshot_hash(snapshot) != snapshot.snapshot_hash \
            or snapshot.source_account_id != account["source_account_id"] \
            or snapshot.policy_version != policy.policy_version \
            or account["policy_version"] != policy.policy_version \
            or account["policy_hash"] != policy.policy_hash:
        raise FinanceError("recovery observation identity or policy differs")
    state = account["reconciliation_state"]
    if state not in {"clean", "quarantined"} or (state == "quarantined" and
            account["reconciliation_reason"] != "reserved_capacity_exceeds_observed"):
        raise FinanceError("unknown financial state cannot be cleared by resolution")
    if state == "quarantined":
        checkpoint = (await conn.execute(text("""
            SELECT observation_snapshot_hash,result,reason
            FROM finance_reconciliation_checkpoints
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
              AND account_revision=:revision
        """), {**_scope(scope), "revision": account["revision"]})).mappings().first()
        if not checkpoint or (checkpoint["observation_snapshot_hash"],
                              checkpoint["result"], checkpoint["reason"]) != (
                snapshot.snapshot_hash, "quarantined", "reserved_capacity_exceeds_observed"):
            raise FinanceError("held-deficit checkpoint does not match resolution evidence")
    if snapshot.status != "accepted" or snapshot.origin != "recorded_fixture" \
            or snapshot.rights_ref != "internal_qualification_only" \
            or snapshot.finality != "admitted_final" or snapshot.finality_at is None \
            or snapshot.has_gap or snapshot.has_reorg \
            or not snapshot.balances_complete or not snapshot.positions_complete \
            or snapshot.observed_positions:
        raise FinanceError("recovery observation is incomplete or unqualified")
    if snapshot.event_at > now or snapshot.available_at > now \
            or snapshot.received_at > now or snapshot.cutoff_at > now \
            or snapshot.finality_at > now \
            or (now - snapshot.event_at).total_seconds() > policy.max_observation_age_seconds:
        raise FinanceError("recovery observation is stale or dated in the future")
    if any(row.book in {"collateral", "liability"} and native_int(row.units) != 0
           for row in snapshot.observed_balances):
        raise FinanceError("recovery observation has unsupported encumbered exposure")
    pending = (await conn.execute(text("""
        SELECT 1 FROM finance_pending_events WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id LIMIT 1
    """), _scope(scope))).first()
    if pending:
        raise FinanceError("unresolved journal event blocks reservation resolution")
    observed = {(row.asset_unit_id, row.location_id, row.book):
                (row.registry_hash, native_int(row.units))
                for row in snapshot.observed_balances if native_int(row.units) != 0}
    ledger = {key: value for key, value in
              (await repo._journal_balances(conn, scope)).items()
              if key[2] in {"wallet", "collateral", "transit", "liability"}}
    if observed != ledger:
        raise FinanceError("recovery observation does not match committed ledger")
    if await capacity_identity_conflict(conn, scope, snapshot):
        raise FinanceError("recovery capacity identity collides")
    wallet = {(row.asset_unit_id, row.registry_hash, row.location_id): native_int(row.units)
              for row in snapshot.observed_balances if row.book == "wallet"}
    held = (await conn.execute(text("""
        SELECT c.capacity_key,c.asset_unit_id,c.registry_hash,c.location_id,sum(c.units) AS units
        FROM finance_reservation_components c JOIN finance_reservations r USING
          (environment,scope_id,strategy_account_id,reservation_id)
        WHERE c.environment=:environment AND c.scope_id=:scope_id
          AND c.strategy_account_id=:strategy_account_id
          AND c.reservation_id<>:target
          AND r.status IN ('reserved','submitted','uncertain')
        GROUP BY c.capacity_key,c.asset_unit_id,c.registry_hash,c.location_id
    """), {**_scope(scope), "target": target_reservation_id})).mappings().all()
    by_identity = defaultdict(int)
    for row in held:
        identity = (row["asset_unit_id"], row["registry_hash"], row["location_id"])
        if row["capacity_key"] != f"asset:{identity[0]}:{identity[2]}":
            raise FinanceError("recovery hold has an ambiguous capacity key")
        by_identity[identity] += db_native_int(row["units"])
    if any(amount > wallet.get(identity, 0) for identity, amount in by_identity.items()):
        raise FinanceError("other retained holds exceed recovered wallet capacity")


async def finish_recovery_snapshot(repo, conn, scope: FinanceScope, account: dict,
                                   snapshot: AccountObservationSnapshotRef,
                                   policy: SizingPolicy, writer_epoch: int, now) -> dict:
    """Call only after the target hold became terminal in this same SQL transaction."""
    revision = account["revision"] + 1
    await repo._replace_capacity(conn, scope, snapshot, policy, revision)
    if await held_excess(conn, scope):
        raise FinanceError("remaining holds exceed recovered wallet capacity")
    balances = await repo._journal_balances(conn, scope)
    root = journal_root((asset, location, book, amount)
        for (asset, location, book), (_, amount) in balances.items())
    await conn.execute(text("""
        INSERT INTO finance_reconciliation_checkpoints(environment,scope_id,
          strategy_account_id,account_revision,observation_snapshot_hash,
          journal_root_hash,result,reason,observed_at)
        VALUES(:environment,:scope_id,:strategy_account_id,:revision,:hash,
          :root,'clean','proof_resolved',:observed)
    """), {**_scope(scope), "revision": revision, "hash": snapshot.snapshot_hash,
           "root": root, "observed": now})
    updated = await repo._advance(conn, scope, writer_epoch, account,
        source_account_id=snapshot.source_account_id,
        observation_snapshot_hash=snapshot.snapshot_hash,
        policy_version=policy.policy_version, policy_hash=policy.policy_hash,
        observed_at=snapshot.event_at, reconciliation_state="clean",
        reconciliation_reason="proof_resolved")
    await repo._outbox(conn, scope, updated)
    return updated
