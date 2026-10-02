"""Experiment-only account snapshot fixture writer and immutable hash lookup."""
from __future__ import annotations

import hashlib
import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .finance_observation_contracts import (
    ARBITRUM_MANAGED_PAIR_COVERAGE, AccountObservationSnapshotRef,
    account_snapshot_from_row,
)


class AccountObservationConflict(ValueError):
    pass


def account_snapshot_hash(snapshot: AccountObservationSnapshotRef) -> str:
    body = snapshot.model_dump(mode="json", exclude={"snapshot_hash"})
    # Keep hashes for pre-coverage-contract full-account snapshots stable.
    if snapshot.coverage_scope == "full_account":
        body.pop("coverage_scope", None)
        body.pop("source_block_number", None)
        body.pop("source_block_hash", None)
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(("moeazi-account-observation-v1\n" + encoded).encode("utf-8")).hexdigest()


class AccountObservationRepository:
    def __init__(self, engine: AsyncEngine):
        self.engine = engine

    async def load_by_hash(self, snapshot_hash: str) -> AccountObservationSnapshotRef | None:
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
            """), {"hash": snapshot_hash})).mappings().first()
        if not row:
            return None
        snapshot = account_snapshot_from_row(row)
        if account_snapshot_hash(snapshot) != snapshot.snapshot_hash:
            raise AccountObservationConflict("Stored account observation hash does not match contents")
        return snapshot

    async def store_experiment_fixture(self, snapshot: AccountObservationSnapshotRef) -> str:
        if snapshot.scope.environment != "experiment" or snapshot.origin != "recorded_fixture" \
                or not snapshot.source_account_id.startswith("fixture:") \
                or snapshot.rights_ref != "internal_qualification_only":
            raise ValueError("Only internally scoped experiment fixtures may be stored here")
        if snapshot.status != "accepted" or snapshot.finality != "admitted_final" \
                or snapshot.has_gap or snapshot.has_reorg \
                or not snapshot.balances_complete or not snapshot.positions_complete:
            raise ValueError("Experiment fixture lacks complete admitted observations")
        if snapshot.finality_at is None or snapshot.finality_at > snapshot.cutoff_at \
                or snapshot.received_at > snapshot.cutoff_at:
            raise ValueError("Experiment fixture finality is unavailable at cutoff")
        if account_snapshot_hash(snapshot) != snapshot.snapshot_hash:
            raise AccountObservationConflict("Account observation hash does not match contents")
        body = snapshot.model_dump(mode="json")
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO observation_account_snapshots
                  (snapshot_hash,environment,scope_id,strategy_account_id,source_account_id,
                   status,origin,observed_balances,observed_positions,balances_complete,
                   positions_complete,event_at,available_at,received_at,cutoff_at,finality,
                   finality_at,has_gap,has_reorg,rights_ref,source_event_hash,source_payload_hash,
                   policy_version,registry_hash)
                VALUES (:hash,:environment,:scope,:account,:source,:status,:origin,
                        CAST(:balances AS jsonb),CAST(:positions AS jsonb),:balances_complete,
                        :positions_complete,:event_at,:available_at,:received_at,:cutoff_at,
                        :finality,:finality_at,:has_gap,:has_reorg,:rights,:event_hash,
                        :payload_hash,:policy,:registry_hash)
                ON CONFLICT DO NOTHING
            """), {
                "hash": snapshot.snapshot_hash, "environment": snapshot.scope.environment,
                "scope": snapshot.scope.scope_id, "account": snapshot.scope.strategy_account_id,
                "source": snapshot.source_account_id, "status": snapshot.status,
                "origin": snapshot.origin,
                "balances": json.dumps(body["observed_balances"], sort_keys=True, ensure_ascii=False),
                "positions": json.dumps(body["observed_positions"], sort_keys=True, ensure_ascii=False),
                "balances_complete": snapshot.balances_complete,
                "positions_complete": snapshot.positions_complete,
                "event_at": snapshot.event_at, "available_at": snapshot.available_at,
                "received_at": snapshot.received_at, "cutoff_at": snapshot.cutoff_at,
                "finality": snapshot.finality, "finality_at": snapshot.finality_at,
                "has_gap": snapshot.has_gap, "has_reorg": snapshot.has_reorg,
                "rights": snapshot.rights_ref, "event_hash": snapshot.source_event_hash,
                "payload_hash": snapshot.source_payload_hash,
                "policy": snapshot.policy_version, "registry_hash": snapshot.registry_hash,
            })
            stored = (await conn.execute(text("""
                SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
            """), {"hash": snapshot.snapshot_hash})).mappings().first()
            if not stored or account_snapshot_from_row(stored) != snapshot:
                raise AccountObservationConflict("Account snapshot identity conflicts with stored contents")
        return snapshot.snapshot_hash

    async def store_native_snapshot(self, snapshot: AccountObservationSnapshotRef) -> str:
        """Persist the one supported native live scope: finalized Arbitrum USDC/WETH.

        The contract validator binds the exact two token identities and the
        finalized source. This is intentionally not a generic live snapshot
        ingress and does not assert full-wallet or position completeness.
        """
        if snapshot.scope.environment != "live" \
                or snapshot.coverage_scope != ARBITRUM_MANAGED_PAIR_COVERAGE \
                or snapshot.origin != "native_verified":
            raise ValueError("Only finalized managed-pair native snapshots are accepted")
        snapshot = AccountObservationSnapshotRef.model_validate(snapshot.model_dump(mode="python"))
        if account_snapshot_hash(snapshot) != snapshot.snapshot_hash:
            raise AccountObservationConflict("Account observation hash does not match contents")
        body = snapshot.model_dump(mode="json")
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO observation_account_snapshots
                  (snapshot_hash,environment,scope_id,strategy_account_id,source_account_id,
                   status,origin,observed_balances,observed_positions,balances_complete,
                   positions_complete,event_at,available_at,received_at,cutoff_at,finality,
                   finality_at,has_gap,has_reorg,rights_ref,source_event_hash,source_payload_hash,
                   policy_version,registry_hash,coverage_scope,source_block_number,source_block_hash)
                VALUES (:hash,:environment,:scope,:account,:source,:status,:origin,
                        CAST(:balances AS jsonb),CAST(:positions AS jsonb),:balances_complete,
                        :positions_complete,:event_at,:available_at,:received_at,:cutoff_at,
                        :finality,:finality_at,:has_gap,:has_reorg,:rights,:event_hash,
                        :payload_hash,:policy,:registry_hash,:coverage_scope,
                        :source_block_number,:source_block_hash)
                ON CONFLICT DO NOTHING
            """), {
                "hash": snapshot.snapshot_hash, "environment": snapshot.scope.environment,
                "scope": snapshot.scope.scope_id, "account": snapshot.scope.strategy_account_id,
                "source": snapshot.source_account_id, "status": snapshot.status,
                "origin": snapshot.origin,
                "balances": json.dumps(body["observed_balances"], sort_keys=True, ensure_ascii=False),
                "positions": json.dumps(body["observed_positions"], sort_keys=True, ensure_ascii=False),
                "balances_complete": snapshot.balances_complete,
                "positions_complete": snapshot.positions_complete,
                "event_at": snapshot.event_at, "available_at": snapshot.available_at,
                "received_at": snapshot.received_at, "cutoff_at": snapshot.cutoff_at,
                "finality": snapshot.finality, "finality_at": snapshot.finality_at,
                "has_gap": snapshot.has_gap, "has_reorg": snapshot.has_reorg,
                "rights": snapshot.rights_ref, "event_hash": snapshot.source_event_hash,
                "payload_hash": snapshot.source_payload_hash,
                "policy": snapshot.policy_version, "registry_hash": snapshot.registry_hash,
                "coverage_scope": snapshot.coverage_scope,
                "source_block_number": snapshot.source_block_number,
                "source_block_hash": snapshot.source_block_hash,
            })
            stored = (await conn.execute(text("""
                SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
            """), {"hash": snapshot.snapshot_hash})).mappings().first()
            if not stored or account_snapshot_from_row(stored) != snapshot:
                raise AccountObservationConflict("Account snapshot identity conflicts with stored contents")
        return snapshot.snapshot_hash
