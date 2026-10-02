"""Scoped PostgreSQL transaction primitives for the single financial writer."""
from __future__ import annotations

from datetime import datetime
from hashlib import sha256
import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from .finance_contracts import FinanceError, FinanceScope, _digest, _hash
from .finance_projection import projection_hash, projection_payload
from .finance_outbox import FinanceOutboxMixin
from .finance_reads import FinanceReadMixin
from .finance_reconciliation import FinanceReconciliationMixin
from .finance_receipts import FinanceReceiptMixin
from .finance_reservations import FinanceReservationMixin
from .finance_submission import FinanceSubmissionMixin
from .finance_dispatch_claim import FinanceDispatchClaimMixin
from .finance_journal import FinanceJournalMixin
from .finance_resolution import FinanceResolutionMixin
from .finance_policy import SizingPolicy
from .finance_live_authority import require_live_finance_authority


def _scope(scope: FinanceScope) -> dict:
    return {"environment": scope.environment, "scope_id": scope.scope_id,
            "strategy_account_id": scope.strategy_account_id}


class FinanceRepository(FinanceOutboxMixin, FinanceReadMixin,
                        FinanceReconciliationMixin, FinanceReceiptMixin,
                        FinanceReservationMixin, FinanceSubmissionMixin,
                        FinanceDispatchClaimMixin, FinanceJournalMixin,
                        FinanceResolutionMixin):
    def __init__(self, dsn_or_engine: str | AsyncEngine):
        self.engine = (create_async_engine(dsn_or_engine, pool_pre_ping=True)
                       if isinstance(dsn_or_engine, str) else dsn_or_engine)

    async def _lock(self, conn, scope: FinanceScope) -> dict:
        row = (await conn.execute(text("""
            SELECT * FROM finance_accounts WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id FOR UPDATE
        """), _scope(scope))).mappings().first()
        if row is None:
            raise FinanceError("financial account is not registered")
        return dict(row)

    async def _db_now(self, conn) -> datetime:
        return (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()

    async def _writer(self, conn, account: dict, writer_epoch: int) -> datetime:
        now = await self._db_now(conn)
        if account["writer_epoch"] != writer_epoch or not account["writer_lease_until"] \
                or account["writer_lease_until"] <= now:
            raise FinanceError("stale or expired financial writer epoch")
        return now

    async def _claim(self, conn, scope: FinanceScope, operation: str,
                     key: str, request_hash: str) -> dict | None:
        row = (await conn.execute(text("""
            SELECT request_hash,result_id,account_revision FROM finance_command_claims
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
              AND operation=:operation AND idempotency_key=:key
        """), {**_scope(scope), "operation": operation, "key": key})).mappings().first()
        if row is not None and row["request_hash"] != request_hash:
            raise FinanceError("financial idempotency key conflicts with a different request")
        return dict(row) if row else None

    async def _insert_claim(self, conn, scope: FinanceScope, operation: str,
                            key: str, request_hash: str, result_id: str,
                            revision: int) -> None:
        await conn.execute(text("""
            INSERT INTO finance_command_claims(environment,scope_id,strategy_account_id,
              operation,idempotency_key,request_hash,result_id,account_revision)
            VALUES(:environment,:scope_id,:strategy_account_id,:operation,:key,
              :request_hash,:result_id,:revision)
        """), {**_scope(scope), "operation": operation, "key": key,
               "request_hash": request_hash, "result_id": result_id,
               "revision": revision})

    @staticmethod
    def _revision(account: dict, expected_revision: int) -> None:
        if account["revision"] != expected_revision:
            raise FinanceError("financial account revision changed")

    async def _advance(self, conn, scope: FinanceScope, writer_epoch: int,
                       account: dict, **changes) -> dict:
        columns = ", ".join(f"{key}=:{key}" for key in changes)
        columns = columns + ", " if columns else ""
        row = (await conn.execute(text(f"""
            UPDATE finance_accounts SET {columns}revision=revision+1,
              updated_at=clock_timestamp()
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
              AND writer_epoch=:writer_epoch AND writer_lease_until>clock_timestamp()
            RETURNING *
        """), {**_scope(scope), "writer_epoch": writer_epoch,
               **changes})).mappings().first()
        if row is None:
            raise FinanceError("financial writer lease expired before commit")
        return dict(row)

    async def _projection_rows(self, conn, scope: FinanceScope) -> tuple[list, list, list]:
        params = _scope(scope)
        balances = (await conn.execute(text("""
            SELECT asset_unit_id,registry_hash,location_id,book,units
            FROM finance_balances WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
        """), params)).mappings().all()
        holds = (await conn.execute(text("""
            SELECT r.reservation_id,r.status,c.capacity_key,c.asset_unit_id,
              c.location_id,c.units FROM finance_reservations r
            JOIN finance_reservation_components c USING
              (environment,scope_id,strategy_account_id,reservation_id)
            WHERE r.environment=:environment AND r.scope_id=:scope_id
              AND r.strategy_account_id=:strategy_account_id
              AND r.status IN ('reserved','submitted','uncertain')
        """), params)).mappings().all()
        capacity = (await conn.execute(text("""
            SELECT capacity_key,asset_unit_id,location_id,limit_units
            FROM finance_capacity WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
        """), params)).mappings().all()
        return [dict(row) for row in balances], [dict(row) for row in holds], [dict(row) for row in capacity]

    async def _outbox(self, conn, scope: FinanceScope, account: dict) -> dict:
        balances, holds, capacity = await self._projection_rows(conn, scope)
        payload = projection_payload(account, balances, holds, capacity,
                                     await self._db_now(conn))
        digest = projection_hash(payload)
        event_id = sha256((f"finance:{scope.environment}:{scope.scope_id}:"
                           f"{scope.strategy_account_id}:{account['revision']}").encode()).hexdigest()
        await conn.execute(text("""
            INSERT INTO finance_outbox(environment,scope_id,strategy_account_id,
              account_revision,event_id,payload_hash,payload)
            VALUES(:environment,:scope_id,:strategy_account_id,:revision,
              :event_id,:digest,CAST(:payload AS jsonb))
        """), {**_scope(scope), "revision": account["revision"], "event_id": event_id,
               "digest": digest, "payload": json.dumps(payload, sort_keys=True,
                   separators=(",", ":"), ensure_ascii=False)})
        return {"eventId": event_id, "payloadHash": digest, "payload": payload}

    async def acquire_writer_epoch(self, scope: FinanceScope, writer_id: str,
                                   lease_seconds: int = 30) -> int:
        if not writer_id or lease_seconds <= 0 or lease_seconds > 300:
            raise FinanceError("invalid financial writer lease")
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO finance_accounts(environment,scope_id,strategy_account_id)
                VALUES(:environment,:scope_id,:strategy_account_id)
                ON CONFLICT DO NOTHING
            """), _scope(scope))
            account = await self._lock(conn, scope)
            now = await self._db_now(conn)
            if account["writer_id"] != writer_id and account["writer_lease_until"] \
                    and account["writer_lease_until"] > now:
                raise FinanceError("another financial writer holds the lease")
            epoch = account["writer_epoch"] if account["writer_id"] == writer_id \
                and account["writer_lease_until"] and account["writer_lease_until"] > now \
                else account["writer_epoch"] + 1
            await conn.execute(text("""
                UPDATE finance_accounts SET writer_epoch=:epoch,writer_id=:writer_id,
                  writer_lease_until=clock_timestamp()+make_interval(secs=>:seconds),
                  updated_at=clock_timestamp()
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), {**_scope(scope), "epoch": epoch, "writer_id": writer_id,
                   "seconds": lease_seconds})
            return epoch

    async def set_account_stop(self, scope: FinanceScope, writer_epoch: int,
                               expected_revision: int, *, stopped: bool,
                               idempotency_key: str, request_hash: str) -> dict:
        expected_hash = _digest("moeazi-finance-command-v1:set-stop", {
            "scope": scope.model_dump(), "stopped": stopped})
        if _hash(request_hash) != expected_hash:
            raise FinanceError("account stop request hash mismatch")
        async with self.engine.begin() as conn:
            account = await self._lock(conn, scope)
            prior = await self._claim(conn, scope, "set_stop", idempotency_key, request_hash)
            if prior:
                old = (await conn.execute(text("""
                    SELECT payload FROM finance_outbox WHERE environment=:environment
                      AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                      AND account_revision=:revision
                """), {**_scope(scope), "revision": prior["account_revision"]})).scalar_one()
                return {"revision": prior["account_revision"], "state": prior["result_id"],
                        "authorityEpoch": int(old["authorityEpoch"])}
            await self._writer(conn, account, writer_epoch)
            self._revision(account, expected_revision)
            if not stopped and scope.environment == "live":
                if account["reconciliation_state"] != "clean" or not account["policy_version"]:
                    raise FinanceError("live financial admission requires clean reconciliation")
                row = (await conn.execute(text("""
                    SELECT policy_json FROM finance_policy_versions
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id
                      AND policy_version=:policy_version
                """), {**_scope(scope), "policy_version": account["policy_version"]})).mappings().first()
                if row is None:
                    raise FinanceError("live financial policy is unavailable")
                policy = SizingPolicy.model_validate(row["policy_json"])
                if policy.policy_hash != account["policy_hash"]:
                    raise FinanceError("live financial policy changed")
                await require_live_finance_authority(conn, scope, account,
                    policy, await self._db_now(conn))
            state = "stopped" if stopped else "open"
            updated = await self._advance(conn, scope, writer_epoch, account,
                admission_state=state, authority_epoch=account["authority_epoch"] + 1)
            await self._insert_claim(conn, scope, "set_stop", idempotency_key,
                                     request_hash, state, updated["revision"])
            await self._outbox(conn, scope, updated)
            return {"revision": updated["revision"], "state": state,
                    "authorityEpoch": updated["authority_epoch"]}
