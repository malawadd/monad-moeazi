"""Experiment-only reservation resolution from immutable, scoped fixture evidence."""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text

from .account_observation_storage import account_snapshot_hash
from .finance_contracts import FinanceError, FinanceScope, _digest, _hash
from .finance_observation_contracts import account_snapshot_from_row
from .finance_recovery import validate_recovery_snapshot, finish_recovery_snapshot
from .finance_resolution_fill import verify_complete_experiment_fill


def _scope(scope: FinanceScope) -> dict:
    return {"environment": scope.environment, "scope_id": scope.scope_id,
            "strategy_account_id": scope.strategy_account_id}


def _time(value: str) -> datetime:
    if not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", value):
        raise FinanceError("resolution fixture time must be UTC milliseconds")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _millis(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class FixtureResolutionEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schemaVersion: Literal[1]
    environment: Literal["experiment"]
    scopeId: str = Field(min_length=1)
    strategyAccountId: str = Field(min_length=1)
    reservationId: str = Field(min_length=1)
    attemptId: str = Field(min_length=1)
    clientId: str = Field(min_length=1)
    normalizedPayloadHash: str
    nativeId: str | None
    sourceOwner: Literal["experiment_fixture"]
    sourceStream: Literal["resolution"]
    sourceEventId: str = Field(min_length=1)
    sourceRevision: str = Field(min_length=1)
    sourceEventHash: str | None
    eventAt: str
    finalityAt: str
    outcome: Literal["rejected_no_fill", "filled"]
    rightsRef: Literal["internal_qualification_only"]
    accountSnapshotHash: str
    linkedTransactionId: str | None

    @model_validator(mode="after")
    def exact_identity(self):
        _hash(self.normalizedPayloadHash)
        _hash(self.accountSnapshotHash)
        _time(self.eventAt)
        _time(self.finalityAt)
        if _time(self.eventAt) > _time(self.finalityAt):
            raise FinanceError("resolution finality precedes event")
        if self.outcome == "filled":
            if self.linkedTransactionId is None or self.sourceEventHash is None:
                raise FinanceError("filled proof requires linked journal identity")
            _hash(self.sourceEventHash)
        elif self.linkedTransactionId is not None or self.sourceEventHash is not None:
            raise FinanceError("no-fill proof cannot claim a journal transaction")
        return self


class FinanceResolutionMixin:
    async def store_experiment_resolution_fixture(
        self, scope: FinanceScope, source_payload: bytes, writer_epoch: int,
    ) -> dict:
        if scope.environment != "experiment" or len(source_payload) > 16_384:
            raise FinanceError("resolution fixture must be bounded and experimental")
        try:
            raw = json.loads(source_payload.decode("utf-8"))
            if not isinstance(raw, dict) or type(raw.get("schemaVersion")) is not int:
                raise ValueError("invalid resolution schema")
            event = FixtureResolutionEvent.model_validate(raw)
        except (UnicodeError, ValueError) as exc:
            raise FinanceError("resolution fixture payload is invalid") from exc
        if (event.environment, event.scopeId, event.strategyAccountId) != (
            scope.environment, scope.scope_id, scope.strategy_account_id):
            raise FinanceError("resolution fixture scope differs")
        source_hash = sha256(source_payload).hexdigest()
        event_hash = event.sourceEventHash or source_hash
        params = {**_scope(scope), "reservation": event.reservationId,
                  "owner": event.sourceOwner, "stream": event.sourceStream,
                  "event_id": event.sourceEventId, "source_revision": event.sourceRevision}
        async with self.engine.begin() as conn:
            account = await self._lock(conn, scope)
            received = await self._writer(conn, account, writer_epoch)
            received = received.replace(microsecond=received.microsecond // 1000 * 1000)
            prior = (await conn.execute(text("""
                SELECT proof_hash,source_payload_hash FROM finance_resolution_proofs
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
                  AND reservation_id=:reservation AND source_owner=:owner
                  AND source_stream=:stream AND source_event_id=:event_id
                  AND source_revision=:source_revision
            """), params)).mappings().first()
            if prior:
                if prior["source_payload_hash"] != source_hash:
                    raise FinanceError("resolution source event conflicts")
                return {"proofHash": prior["proof_hash"]}
            alternate = (await conn.execute(text("""
                SELECT 1 FROM finance_resolution_proofs WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND attempt_id=:attempt LIMIT 1
            """), {**_scope(scope), "attempt": event.attemptId})).first()
            if alternate:
                raise FinanceError("submission attempt already has a different final proof")
            attempt = (await conn.execute(text("""
                SELECT reservation_id,client_id,normalized_payload_hash,created_at
                FROM finance_submission_attempts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND attempt_id=:attempt
            """), {**_scope(scope), "attempt": event.attemptId})).mappings().first()
            if not attempt or (attempt["reservation_id"], attempt["client_id"],
                              attempt["normalized_payload_hash"]) != (
                    event.reservationId, event.clientId, event.normalizedPayloadHash):
                raise FinanceError("resolution fixture does not bind submission attempt")
            if _time(event.eventAt) < attempt["created_at"] or _time(event.finalityAt) > received:
                raise FinanceError("resolution fixture has impossible event or finality time")
            snapshot = (await conn.execute(text("""
                SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
            """), {"hash": event.accountSnapshotHash})).mappings().first()
            if not snapshot or (snapshot["environment"], snapshot["scope_id"],
                                snapshot["strategy_account_id"]) != (
                    scope.environment, scope.scope_id, scope.strategy_account_id):
                raise FinanceError("resolution fixture account snapshot is unavailable")
            body = {**event.model_dump(), "sourceEventHash": event_hash,
                    "sourcePayloadHash": source_hash, "receivedAt": _millis(received),
                    "origin": "recorded_fixture"}
            proof_hash = _digest("moeazi-finance-resolution-v1", body)
            await conn.execute(text("""
                INSERT INTO finance_resolution_proofs(environment,scope_id,strategy_account_id,
                  proof_hash,reservation_id,attempt_id,client_id,normalized_payload_hash,native_id,
                  source_owner,source_stream,source_event_id,source_revision,source_event_hash,
                  source_payload_hash,event_at,received_at,finality_at,outcome,rights_ref,origin,
                  account_snapshot_hash,linked_transaction_id,proof_json)
                VALUES(:environment,:scope_id,:strategy_account_id,:proof,:reservation,:attempt,
                  :client,:payload,:native,:owner,:stream,:event_id,:source_revision,:event_hash,
                  :source_hash,:event_at,:received_at,:finality_at,:outcome,:rights,:origin,
                  :snapshot,:transaction,CAST(:body AS jsonb))
            """), {**params, "proof": proof_hash, "attempt": event.attemptId,
                   "client": event.clientId, "payload": event.normalizedPayloadHash,
                   "native": event.nativeId, "event_hash": event_hash,
                   "source_hash": source_hash, "event_at": _time(event.eventAt),
                   "received_at": received, "finality_at": _time(event.finalityAt),
                   "outcome": event.outcome, "rights": event.rightsRef,
                   "origin": "recorded_fixture", "snapshot": event.accountSnapshotHash,
                   "transaction": event.linkedTransactionId,
                   "body": json.dumps(body, sort_keys=True, separators=(",", ":"),
                                      ensure_ascii=False)})
            return {"proofHash": proof_hash}

    async def resolve_reservation(
        self, scope: FinanceScope, reservation_id: str, proof_hash: str,
        writer_epoch: int, expected_revision: int, idempotency_key: str,
    ) -> dict:
        if scope.environment != "experiment" or not reservation_id or not idempotency_key:
            raise FinanceError("Stage 2 resolution is experiment-only")
        _hash(proof_hash)
        request_hash = _digest("moeazi-finance-command-v1:resolve", {
            "scope": scope.model_dump(), "reservationId": reservation_id,
            "proofHash": proof_hash})
        async with self.engine.begin() as conn:
            account = await self._lock(conn, scope)
            prior = await self._claim(conn, scope, "resolve", idempotency_key, request_hash)
            if prior:
                reservation = await self._reservation(conn, scope, reservation_id)
                return {"reservationId": reservation_id, "revision": prior["account_revision"],
                        "status": reservation["status"]}
            now = await self._writer(conn, account, writer_epoch)
            self._revision(account, expected_revision)
            reservation = await self._reservation(conn, scope, reservation_id)
            if reservation["status"] not in {"submitted", "uncertain"}:
                raise FinanceError("resolution requires a retained submitted reservation")
            proof = (await conn.execute(text("""
                SELECT * FROM finance_resolution_proofs WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND reservation_id=:reservation AND proof_hash=:proof
            """), {**_scope(scope), "reservation": reservation_id,
                   "proof": proof_hash})).mappings().first()
            if not proof or _digest("moeazi-finance-resolution-v1", proof["proof_json"]) != proof_hash:
                raise FinanceError("stored resolution proof is missing or altered")
            body = proof["proof_json"]
            if (body.get("reservationId"), body.get("attemptId"),
                body.get("clientId"), body.get("normalizedPayloadHash"),
                body.get("sourceEventHash"), body.get("sourcePayloadHash"),
                body.get("accountSnapshotHash"), body.get("linkedTransactionId"),
                body.get("outcome")) != (
                proof["reservation_id"], proof["attempt_id"], proof["client_id"],
                proof["normalized_payload_hash"], proof["source_event_hash"],
                proof["source_payload_hash"], proof["account_snapshot_hash"],
                proof["linked_transaction_id"], proof["outcome"]):
                raise FinanceError("stored resolution columns differ from proof content")
            if (body.get("sourceOwner"), body.get("sourceStream"),
                body.get("sourceEventId"), body.get("sourceRevision"),
                body.get("eventAt"), body.get("finalityAt"), body.get("receivedAt"),
                body.get("rightsRef"), body.get("origin")) != (
                proof["source_owner"], proof["source_stream"],
                proof["source_event_id"], proof["source_revision"],
                _millis(proof["event_at"]), _millis(proof["finality_at"]),
                _millis(proof["received_at"]), proof["rights_ref"], proof["origin"]):
                raise FinanceError("stored resolution provenance differs from proof content")
            attempt = (await conn.execute(text("""
                SELECT * FROM finance_submission_attempts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND attempt_id=:attempt AND reservation_id=:reservation FOR UPDATE
            """), {**_scope(scope), "attempt": proof["attempt_id"],
                   "reservation": reservation_id})).mappings().first()
            if not attempt or attempt["status"] != "possible" or (
                attempt["client_id"], attempt["normalized_payload_hash"], attempt["native_id"]
            ) != (proof["client_id"], proof["normalized_payload_hash"], None):
                raise FinanceError("resolution attempt identity or state changed")
            if proof["origin"] != "recorded_fixture" or proof["rights_ref"] != \
                    "internal_qualification_only" or proof["received_at"] > now or \
                    proof["event_at"] < attempt["created_at"] or \
                    proof["event_at"] > proof["finality_at"] or \
                    proof["finality_at"] > proof["received_at"]:
                raise FinanceError("resolution source is not final or available")
            snapshot_row = (await conn.execute(text("""
                SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
            """), {"hash": proof["account_snapshot_hash"]})).mappings().first()
            if not snapshot_row:
                raise FinanceError("resolution account evidence is missing")
            snapshot = account_snapshot_from_row(snapshot_row)
            if account_snapshot_hash(snapshot) != snapshot.snapshot_hash or \
                    snapshot.scope != scope or snapshot.status != "accepted" or \
                    snapshot.finality != "admitted_final" or snapshot.has_gap or \
                    snapshot.has_reorg or not snapshot.balances_complete or \
                    not snapshot.positions_complete or \
                    snapshot.source_account_id != account["source_account_id"] or \
                    snapshot.event_at < proof["finality_at"] or \
                    snapshot.event_at < attempt["created_at"] or \
                    snapshot.available_at > now or snapshot.received_at > now or \
                    snapshot.cutoff_at > now or snapshot.finality_at is None or \
                    snapshot.finality_at > now:
                raise FinanceError("later complete account evidence cannot resolve reservation")
            policy = await self._receipt_policy(conn, scope, account["policy_version"])
            if proof["outcome"] == "filled":
                transaction = (await conn.execute(text("""
                    SELECT t.transaction_id,e.observed_at FROM finance_journal_transactions t
                    JOIN finance_source_events e USING
                      (environment,scope_id,strategy_account_id,source_event_hash)
                    WHERE t.environment=:environment AND t.scope_id=:scope_id
                      AND t.strategy_account_id=:strategy_account_id
                      AND t.transaction_id=:transaction AND
                      e.source_event_hash=:event_hash AND e.event_kind=:kind
                      AND t.account_revision>:admitted_revision
                """), {**_scope(scope), "transaction": proof["linked_transaction_id"],
                       "event_hash": proof["source_event_hash"],
                       "kind": "fill" if reservation["purpose"] == "trade" else "withdrawal",
                       "admitted_revision": reservation["admitted_revision"]})).mappings().first()
                if not transaction or transaction["observed_at"] < attempt["created_at"] \
                        or snapshot.event_at < transaction["observed_at"]:
                    raise FinanceError("filled resolution lacks matching journal event")
                await verify_complete_experiment_fill(conn, scope, reservation,
                                                      proof["linked_transaction_id"])
                status, attempt_status = "settled", "confirmed"
            elif proof["outcome"] == "rejected_no_fill" and proof["linked_transaction_id"] is None:
                later_journal = (await conn.execute(text("""
                    SELECT 1 FROM finance_journal_transactions WHERE environment=:environment
                      AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                      AND account_revision>:revision LIMIT 1
                """), {**_scope(scope), "revision": reservation["admitted_revision"]})).first()
                if later_journal:
                    raise FinanceError("no-fill proof cannot exclude later journal activity")
                status, attempt_status = "released", "rejected"
            else:
                raise FinanceError("resolution outcome is unsupported")
            await validate_recovery_snapshot(self, conn, scope, account, snapshot,
                                             policy, now, reservation_id)
            await conn.execute(text("""
                UPDATE finance_submission_attempts SET status=:status,native_id=:native
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND attempt_id=:attempt
            """), {**_scope(scope), "status": attempt_status,
                   "native": proof["native_id"], "attempt": proof["attempt_id"]})
            await conn.execute(text("""
                UPDATE finance_reservations SET status=:status,retention_reason=NULL,
                  resolution_proof_hash=:proof,updated_at=clock_timestamp()
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND reservation_id=:reservation
            """), {**_scope(scope), "status": status, "proof": proof_hash,
                   "reservation": reservation_id})
            updated = await finish_recovery_snapshot(self, conn, scope, account,
                                                     snapshot, policy, writer_epoch, now)
            await self._insert_claim(conn, scope, "resolve", idempotency_key,
                                     request_hash, reservation_id, updated["revision"])
            return {"reservationId": reservation_id, "revision": updated["revision"],
                    "status": status}
