"""Admit stored account observations and reconcile exact journal state."""
from __future__ import annotations

from hashlib import sha256
import json

from sqlalchemy import text
from pydantic import ValidationError

from .account_observation_storage import account_snapshot_hash
from .finance_contracts import FinanceError, FinanceScope, ReconcileCommand, db_native_int, native_int
from .finance_observation_contracts import (
    ARBITRUM_MANAGED_PAIR_COVERAGE, AccountObservationSnapshotRef,
    account_snapshot_from_row, snapshot_coverage_is_complete,
)
from .finance_oracle import journal_root
from .finance_policy import SizingPolicy
from .finance_capacity import capacity_identity_conflict, held_excess


def _scope(scope: FinanceScope) -> dict:
    return {"environment": scope.environment, "scope_id": scope.scope_id,
            "strategy_account_id": scope.strategy_account_id}


class FinanceReconciliationMixin:
    async def register_policy(self, scope: FinanceScope, writer_epoch: int,
                              policy: SizingPolicy) -> None:
        """Internal policy registration; Stage 2 does not expose live approval."""
        async with self.engine.begin() as conn:
            account = await self._lock(conn, scope)
            await self._writer(conn, account, writer_epoch)
            old = (await conn.execute(text("""
                SELECT policy_hash FROM finance_policy_versions
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND policy_version=:version
            """), {**_scope(scope), "version": policy.policy_version})).scalar_one_or_none()
            if old is not None:
                if old != policy.policy_hash:
                    raise FinanceError("immutable financial policy version conflict")
                return
            await conn.execute(text("""
                INSERT INTO finance_policy_versions(environment,scope_id,strategy_account_id,
                  policy_version,policy_hash,policy_json,approved_live)
                VALUES(:environment,:scope_id,:strategy_account_id,:version,:hash,
                  CAST(:policy AS jsonb),:approved)
            """), {**_scope(scope), "version": policy.policy_version,
                   "hash": policy.policy_hash,
                   "policy": json.dumps(policy.model_dump(), sort_keys=True),
                   "approved": policy.approved_live})

    async def _stored_snapshot(self, conn, command: ReconcileCommand
                               ) -> AccountObservationSnapshotRef | None:
        row = (await conn.execute(text("""
            SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
        """), {"hash": command.snapshot_hash})).mappings().first()
        if row is None:
            return None
        snapshot = account_snapshot_from_row(row)
        if account_snapshot_hash(snapshot) != snapshot.snapshot_hash:
            raise FinanceError("stored account observation hash mismatch")
        return snapshot

    async def _policy(self, conn, command: ReconcileCommand) -> SizingPolicy | None:
        row = (await conn.execute(text("""
            SELECT policy_json,policy_hash FROM finance_policy_versions
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND policy_version=:version
        """), {**_scope(command.scope), "version": command.policy_version})).mappings().first()
        if row is None or row["policy_hash"] != command.policy_hash:
            return None
        return SizingPolicy.model_validate(row["policy_json"])

    async def _journal_balances(self, conn, scope: FinanceScope) -> dict:
        rows = (await conn.execute(text("""
            SELECT asset_unit_id,registry_hash,location_id,book,units FROM finance_balances
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
        """), _scope(scope))).mappings().all()
        return {(r["asset_unit_id"], r["location_id"], r["book"]):
                (r["registry_hash"], db_native_int(r["units"]))
                for r in rows if db_native_int(r["units"]) != 0}

    async def _opening(self, conn, scope: FinanceScope,
                       snapshot: AccountObservationSnapshotRef, revision: int) -> None:
        rows = [r for r in snapshot.observed_balances if native_int(r.units) != 0]
        if not rows:
            return
        tx_id = sha256(("opening:" + scope.environment + ":" + scope.scope_id + ":"
                        + scope.strategy_account_id + ":" + snapshot.snapshot_hash).encode()).hexdigest()
        await conn.execute(text("""
            INSERT INTO finance_source_events(environment,scope_id,strategy_account_id,
              source_event_hash,source_owner,source_stream,source_event_id,source_revision,
              source_payload_hash,event_kind,observed_at)
            VALUES(:environment,:scope_id,:strategy_account_id,:event,'observation',
              'opening',:snapshot,'1',:payload,'opening',:observed)
        """), {**_scope(scope), "event": snapshot.source_event_hash,
               "snapshot": snapshot.snapshot_hash, "payload": snapshot.source_payload_hash,
               "observed": snapshot.event_at})
        await conn.execute(text("""
            INSERT INTO finance_journal_transactions(environment,scope_id,strategy_account_id,
              transaction_id,source_event_hash,posting_count,request_hash,account_revision)
            VALUES(:environment,:scope_id,:strategy_account_id,:tx,:event,:count,:hash,:revision)
        """), {**_scope(scope), "tx": tx_id, "event": snapshot.source_event_hash,
               "count": len(rows) * 2, "hash": snapshot.snapshot_hash,
               "revision": revision})
        for index, row in enumerate(rows):
            for offset, (location, book, units) in enumerate((
                    (row.location_id, row.book, row.units),
                    ("external:opening", "external", str(-native_int(row.units))))):
                await conn.execute(text("""
                    INSERT INTO finance_journal_postings(environment,scope_id,strategy_account_id,
                      transaction_id,ordinal,asset_unit_id,registry_hash,location_id,book,units)
                    VALUES(:environment,:scope_id,:strategy_account_id,:tx,:ordinal,
                      :asset,:registry,:location,:book,:units)
                """), {**_scope(scope), "tx": tx_id, "ordinal": index * 2 + offset + 1,
                       "asset": row.asset_unit_id, "registry": row.registry_hash,
                       "location": location, "book": book, "units": units})
                await self._balance_delta(conn, scope, row.asset_unit_id, row.registry_hash,
                                          location, book, units, revision)

    async def _balance_delta(self, conn, scope: FinanceScope, asset: str, registry: str,
                             location: str, book: str, units: str, revision: int) -> None:
        old = (await conn.execute(text("""
            SELECT registry_hash FROM finance_balances WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
              AND asset_unit_id=:asset AND location_id=:location AND book=:book
        """), {**_scope(scope), "asset": asset, "location": location,
               "book": book})).scalar_one_or_none()
        if old is not None and old != registry:
            raise FinanceError("asset registry version changed inside one financial balance")
        await conn.execute(text("""
            INSERT INTO finance_balances(environment,scope_id,strategy_account_id,
              asset_unit_id,registry_hash,location_id,book,units,account_revision)
            VALUES(:environment,:scope_id,:strategy_account_id,:asset,:registry,
              :location,:book,:units,:revision)
            ON CONFLICT (environment,scope_id,strategy_account_id,asset_unit_id,location_id,book)
            DO UPDATE SET units=finance_balances.units+EXCLUDED.units,
              account_revision=EXCLUDED.account_revision
        """), {**_scope(scope), "asset": asset, "registry": registry,
               "location": location, "book": book,
               "units": units, "revision": revision})

    async def _replace_capacity(self, conn, scope: FinanceScope,
                                snapshot: AccountObservationSnapshotRef,
                                policy: SizingPolicy, revision: int) -> None:
        await conn.execute(text("""
            UPDATE finance_capacity SET limit_units=0,snapshot_hash=:hash,
              policy_version=:policy,policy_hash=:policy_hash,account_revision=:revision
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
        """), {**_scope(scope), "hash": snapshot.snapshot_hash,
               "policy": policy.policy_version, "policy_hash": policy.policy_hash,
               "revision": revision})
        for row in snapshot.observed_balances:
            if row.book != "wallet":
                continue
            key = f"asset:{row.asset_unit_id}:{row.location_id}"
            await conn.execute(text("""
                INSERT INTO finance_capacity(environment,scope_id,strategy_account_id,
                  capacity_key,asset_unit_id,registry_hash,location_id,limit_units,
                  snapshot_hash,policy_version,policy_hash,account_revision)
                VALUES(:environment,:scope_id,:strategy_account_id,:key,:asset,:registry,
                  :location,:units,:hash,:policy,:policy_hash,:revision)
                ON CONFLICT (environment,scope_id,strategy_account_id,capacity_key)
                DO UPDATE SET limit_units=EXCLUDED.limit_units,
                  snapshot_hash=EXCLUDED.snapshot_hash,
                  policy_version=EXCLUDED.policy_version,
                  policy_hash=EXCLUDED.policy_hash,account_revision=EXCLUDED.account_revision
            """), {**_scope(scope), "key": key, "asset": row.asset_unit_id,
                   "registry": row.registry_hash, "location": row.location_id,
                   "units": row.units, "hash": snapshot.snapshot_hash,
                   "policy": policy.policy_version, "policy_hash": policy.policy_hash,
                   "revision": revision})

    async def reconcile_account(self, command: ReconcileCommand,
                                *, bootstrap: bool = False) -> dict:
        scope = command.scope
        async with self.engine.begin() as conn:
            account = await self._lock(conn, scope)
            operation = "bootstrap" if bootstrap else "reconcile"
            old = await self._claim(conn, scope, operation, command.idempotency_key,
                                    command.request_hash)
            if old:
                return {"revision": old["account_revision"], "status": old["result_id"]}
            await self._writer(conn, account, command.writer_epoch)
            self._revision(account, command.expected_revision)
            invalid_snapshot = False
            try:
                snapshot = await self._stored_snapshot(conn, command)
            except (FinanceError, ValidationError):
                snapshot = None
                invalid_snapshot = True
            policy = await self._policy(conn, command)
            now = await self._db_now(conn)
            pending_event = (await conn.execute(text("""
                SELECT 1 FROM finance_pending_events WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id LIMIT 1
            """), _scope(scope))).first()
            reason = None
            if pending_event:
                reason = "pending_journal_event"
            elif invalid_snapshot:
                reason = "snapshot_integrity_mismatch"
            elif snapshot is None or policy is None:
                reason = "missing_snapshot_or_policy"
            elif snapshot.scope != scope or snapshot.policy_version != policy.policy_version:
                reason = "scope_or_policy_mismatch"
            elif account["source_account_id"] and account["source_account_id"] != snapshot.source_account_id:
                reason = "source_account_changed"
            elif scope.environment == "live" and bootstrap \
                    and snapshot.coverage_scope != ARBITRUM_MANAGED_PAIR_COVERAGE:
                reason = "live_bootstrap_not_qualified"
            elif snapshot.status != "accepted" or snapshot.finality != "admitted_final" \
                    or snapshot.finality_at is None or snapshot.has_gap or snapshot.has_reorg \
                    or not snapshot_coverage_is_complete(snapshot):
                reason = "observation_not_final_complete"
            elif scope.environment == "experiment" and (
                    snapshot.rights_ref != "internal_qualification_only" or
                    snapshot.origin not in {"recorded_fixture", "native_verified"}):
                reason = "observation_rights_unqualified"
            elif snapshot.event_at > now or snapshot.available_at > now \
                    or snapshot.received_at > now or snapshot.cutoff_at > now \
                    or snapshot.finality_at > now \
                    or (now - snapshot.event_at).total_seconds() > policy.max_observation_age_seconds:
                reason = "observation_stale_or_future"
            elif bootstrap and (account["source_account_id"] is not None or
                                (await self._journal_balances(conn, scope))):
                reason = "account_already_bootstrapped"
            elif not bootstrap and account["source_account_id"] is None:
                reason = "account_not_bootstrapped"
            elif snapshot.observed_positions:
                reason = "perp_exposure_unvalued"
            elif any(r.book in {"collateral", "liability"} and native_int(r.units) != 0
                     for r in snapshot.observed_balances):
                reason = "encumbered_balance_unsupported"
            else:
                observed = {(r.asset_unit_id, r.location_id, r.book):
                            (r.registry_hash, native_int(r.units))
                            for r in snapshot.observed_balances if native_int(r.units) != 0}
                if not bootstrap:
                    ledger = {key: value for key, value in
                              (await self._journal_balances(conn, scope)).items()
                              if key[2] in {"wallet", "collateral", "transit", "liability"}}
                    if observed != ledger:
                        reason = "balance_mismatch"
            revision = account["revision"] + 1
            if reason is None and await capacity_identity_conflict(conn, scope, snapshot):
                reason = "capacity_identity_collision"
            if reason is None and bootstrap:
                await self._opening(conn, scope, snapshot, revision)
            if reason is None:
                await self._replace_capacity(conn, scope, snapshot, policy, revision)
                if await held_excess(conn, scope):
                    reason = "reserved_capacity_exceeds_observed"
            status = "clean" if reason is None else ("unknown" if reason in {
                "missing_snapshot_or_policy", "observation_stale_or_future",
                "account_not_bootstrapped", "perp_exposure_unvalued",
                "live_bootstrap_not_qualified"} else "quarantined")
            balances = await self._journal_balances(conn, scope)
            root = journal_root((asset, location, book, amount)
                for (asset, location, book), (_, amount) in balances.items())
            await conn.execute(text("""
                INSERT INTO finance_reconciliation_checkpoints(environment,scope_id,
                  strategy_account_id,account_revision,observation_snapshot_hash,
                  journal_root_hash,result,reason,observed_at)
                VALUES(:environment,:scope_id,:strategy_account_id,:revision,:hash,
                  :root,:status,:reason,:observed)
            """), {**_scope(scope), "revision": revision, "hash": command.snapshot_hash,
                   "root": root, "status": status, "reason": reason or "matched",
                   "observed": now})
            changes = {"reconciliation_state": status,
                       "reconciliation_reason": reason or "matched"}
            if reason is None and snapshot is not None:
                changes.update(source_account_id=snapshot.source_account_id,
                    observation_snapshot_hash=snapshot.snapshot_hash,
                    policy_version=policy.policy_version, policy_hash=policy.policy_hash,
                    observed_at=snapshot.event_at)
            updated = await self._advance(conn, scope, command.writer_epoch, account,
                                          **changes)
            await self._insert_claim(conn, scope, operation, command.idempotency_key,
                                     command.request_hash, status, revision)
            await self._outbox(conn, scope, updated)
            return {"revision": revision, "status": status, "reason": reason or "matched"}
