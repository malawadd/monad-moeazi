"""Exact, deduplicated financial journal events under the scoped SQL writer lock."""
from __future__ import annotations

from hashlib import sha256
import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, JournalCommand, db_native_int, native_int
from .finance_oracle import balanced_postings, projected_balances


def _scope(scope: FinanceScope) -> dict:
    return {"environment": scope.environment, "scope_id": scope.scope_id,
            "strategy_account_id": scope.strategy_account_id}


def _transaction_id(command: JournalCommand) -> str:
    source = f"journal:{command.scope.environment}:{command.scope.scope_id}:" \
             f"{command.scope.strategy_account_id}:{command.source_event_hash}"
    return sha256(source.encode("utf-8")).hexdigest()


class FinanceJournalMixin:
    async def _source_event(self, conn, command: JournalCommand):
        return (await conn.execute(text("""
            SELECT e.source_event_hash,e.source_payload_hash,e.source_revision,
              t.transaction_id,t.request_hash,t.account_revision
            FROM finance_source_events e
            JOIN finance_journal_transactions t USING
              (environment,scope_id,strategy_account_id,source_event_hash)
            WHERE e.environment=:environment AND e.scope_id=:scope_id
              AND e.strategy_account_id=:strategy_account_id
              AND e.source_owner=:owner AND e.source_stream=:stream
              AND e.source_event_id=:event_id
            ORDER BY e.created_at LIMIT 1
        """), {**_scope(command.scope), "owner": command.source_owner,
               "stream": command.source_stream,
               "event_id": command.source_event_id})).mappings().first()

    async def _pending_event(self, conn, command: JournalCommand):
        return (await conn.execute(text("""
            SELECT source_event_hash,request_hash,command_json,reason
            FROM finance_pending_events WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
              AND source_event_hash=:hash
        """), {**_scope(command.scope), "hash": command.source_event_hash})).mappings().first()

    async def _current_balances(self, conn, scope: FinanceScope) -> dict:
        rows = (await conn.execute(text("""
            SELECT asset_unit_id,location_id,book,units FROM finance_balances
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
        """), _scope(scope))).mappings().all()
        return {(row["asset_unit_id"], row["location_id"], row["book"]):
                db_native_int(row["units"]) for row in rows}

    async def _verify_reversal(self, conn, command: JournalCommand) -> str | None:
        if command.kind != "correction_reversal":
            return None
        original = (await conn.execute(text("""
            SELECT source_event_hash FROM finance_journal_transactions
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND transaction_id=:tx
        """), {**_scope(command.scope), "tx": command.reverses_transaction_id})).mappings().first()
        if not original:
            raise FinanceError("reversal must reference a transaction in the same scope")
        reversed_already = (await conn.execute(text("""
            SELECT transaction_id FROM finance_journal_transactions
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND reverses_transaction_id=:tx
        """), {**_scope(command.scope), "tx": command.reverses_transaction_id})).first()
        if reversed_already:
            raise FinanceError("financial transaction already has a full reversal")
        rows = (await conn.execute(text("""
            SELECT asset_unit_id,registry_hash,location_id,book,units
            FROM finance_journal_postings WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
              AND transaction_id=:tx ORDER BY ordinal
        """), {**_scope(command.scope), "tx": command.reverses_transaction_id})).mappings().all()
        if len(rows) != len(command.postings):
            raise FinanceError("full reversal posting count differs")
        for stored, proposed in zip(rows, command.postings):
            if (stored["asset_unit_id"], stored["registry_hash"], stored["location_id"],
                stored["book"], int(stored["units"])) != (
                    proposed.asset_unit_id, proposed.registry_hash,
                    proposed.location_id, proposed.book, -native_int(proposed.units)):
                raise FinanceError("reversal must negate every original posting exactly")
        return original["source_event_hash"]

    async def _same_postings(self, conn, command: JournalCommand,
                             transaction_id: str) -> bool:
        rows = (await conn.execute(text("""
            SELECT asset_unit_id,registry_hash,location_id,book,units
            FROM finance_journal_postings WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
              AND transaction_id=:tx ORDER BY ordinal
        """), {**_scope(command.scope), "tx": transaction_id})).mappings().all()
        return len(rows) == len(command.postings) and all(
            (row["asset_unit_id"], row["registry_hash"], row["location_id"],
             row["book"], int(row["units"])) ==
            (posting.asset_unit_id, posting.registry_hash, posting.location_id,
             posting.book, native_int(posting.units))
            for row, posting in zip(rows, command.postings))

    async def apply_journal_event(self, command: JournalCommand) -> dict:
        """Apply an economic source in its own transaction."""
        command = JournalCommand.model_validate_json(command.model_dump_json())
        if command.scope.environment != "experiment":
            raise FinanceError("live journal ingestion requires a verified native source adapter")
        balanced_postings(command.postings)
        async with self.engine.begin() as conn:
            account = await self._lock(conn, command.scope)
            return await self.apply_journal_event_locked(conn, command, account)

    async def apply_journal_event_locked(self, conn, command: JournalCommand,
                                         account: dict) -> dict:
        """Apply the same source inside a caller-held account transaction."""
        command = JournalCommand.model_validate_json(command.model_dump_json())
        if command.scope.environment != "experiment":
            raise FinanceError("live journal ingestion requires a verified native source adapter")
        balanced_postings(command.postings)
        scope = command.scope
        if any(account[key] != value for key, value in _scope(scope).items()):
            raise FinanceError("locked journal account differs from source scope")
        tx_id = _transaction_id(command)
        old_claim = await self._claim(conn, scope, "journal",
                                      command.idempotency_key, command.request_hash)
        if old_claim:
            return {"transactionId": old_claim["result_id"],
                    "revision": old_claim["account_revision"], "status": "applied"}
        await self._writer(conn, account, command.writer_epoch)
        existing = await self._source_event(conn, command)
        if existing:
            if command.kind == "fill" and existing["source_payload_hash"] == command.source_payload_hash \
                    and await self._same_postings(conn, command, existing["transaction_id"]):
                return {"transactionId": existing["transaction_id"],
                        "revision": existing["account_revision"], "status": "applied"}
            if existing["source_event_hash"] != command.source_event_hash \
                    or existing["request_hash"] != command.request_hash:
                raise FinanceError("native source event conflicts; append a correction")
            return {"transactionId": existing["transaction_id"],
                    "revision": existing["account_revision"], "status": "applied"}
        pending = await self._pending_event(conn, command)
        if pending and pending["request_hash"] != command.request_hash:
            raise FinanceError("pending source event conflicts with a changed request")
        if pending and command.expected_revision != account["revision"]:
            return {"transactionId": tx_id, "revision": account["revision"],
                    "status": "pending"}
        self._revision(account, command.expected_revision)
        reverses_event_hash = await self._verify_reversal(conn, command)
        current = await self._current_balances(conn, scope)
        try:
            projected_balances(current, command.postings)
        except FinanceError as exc:
            if str(exc) != "financial asset balance cannot become negative":
                raise
            if pending is None:
                await conn.execute(text("""
                    INSERT INTO finance_pending_events(environment,scope_id,strategy_account_id,
                      source_event_hash,request_hash,command_json,reason)
                    VALUES(:environment,:scope_id,:strategy_account_id,:hash,:request,
                      CAST(:command AS jsonb),'out_of_order_negative')
                """), {**_scope(scope), "hash": command.source_event_hash,
                       "request": command.request_hash,
                       "command": json.dumps(command.model_dump(mode="json"),
                           sort_keys=True, separators=(",", ":"), ensure_ascii=False)})
                updated = await self._advance(conn, scope, command.writer_epoch, account,
                    reconciliation_state="quarantined",
                    reconciliation_reason="out_of_order_negative")
                await self._outbox(conn, scope, updated)
                return {"transactionId": tx_id, "revision": updated["revision"],
                        "status": "pending"}
            return {"transactionId": tx_id, "revision": account["revision"],
                    "status": "pending"}
        revision = account["revision"] + 1
        await conn.execute(text("""
            INSERT INTO finance_source_events(environment,scope_id,strategy_account_id,
              source_event_hash,source_owner,source_stream,source_event_id,source_revision,
              source_payload_hash,event_kind,observed_at,reverses_event_hash)
            VALUES(:environment,:scope_id,:strategy_account_id,:hash,:owner,:stream,
              :event_id,:source_revision,:payload,:kind,:observed,:reverses)
        """), {**_scope(scope), "hash": command.source_event_hash,
               "owner": command.source_owner, "stream": command.source_stream,
               "event_id": command.source_event_id,
               "source_revision": command.source_revision,
               "payload": command.source_payload_hash, "kind": command.kind,
               "observed": command.observed_at,
               "reverses": reverses_event_hash})
        await conn.execute(text("""
            INSERT INTO finance_journal_transactions(environment,scope_id,strategy_account_id,
              transaction_id,source_event_hash,reverses_transaction_id,posting_count,
              request_hash,account_revision)
            VALUES(:environment,:scope_id,:strategy_account_id,:tx,:source,:reverses,
              :count,:request,:revision)
        """), {**_scope(scope), "tx": tx_id, "source": command.source_event_hash,
               "reverses": command.reverses_transaction_id,
               "count": len(command.postings), "request": command.request_hash,
               "revision": revision})
        for ordinal, posting in enumerate(command.postings, start=1):
            await conn.execute(text("""
                INSERT INTO finance_journal_postings(environment,scope_id,strategy_account_id,
                  transaction_id,ordinal,asset_unit_id,registry_hash,location_id,book,units)
                VALUES(:environment,:scope_id,:strategy_account_id,:tx,:ordinal,:asset,
                  :registry,:location,:book,:units)
            """), {**_scope(scope), "tx": tx_id, "ordinal": ordinal,
                   "asset": posting.asset_unit_id, "registry": posting.registry_hash,
                   "location": posting.location_id, "book": posting.book,
                   "units": posting.units})
            await self._balance_delta(conn, scope, posting.asset_unit_id,
                posting.registry_hash, posting.location_id, posting.book,
                posting.units, revision)
        if pending:
            await conn.execute(text("""
                DELETE FROM finance_pending_events WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND source_event_hash=:hash
            """), {**_scope(scope), "hash": command.source_event_hash})
        updated = await self._advance(conn, scope, command.writer_epoch, account,
            reconciliation_state="unknown", reconciliation_reason="journal_ahead_of_observation")
        await self._insert_claim(conn, scope, "journal", command.idempotency_key,
                                 command.request_hash, tx_id, updated["revision"])
        await self._outbox(conn, scope, updated)
        return {"transactionId": tx_id, "revision": updated["revision"],
                "status": "applied"}
