"""Durable possible-submission tracking; expiry never frees uncertain exposure."""
from __future__ import annotations

from datetime import datetime
from hashlib import sha256
import json

from sqlalchemy import text
from pydantic import ValidationError

from .account_observation_storage import account_snapshot_hash
from .finance_contracts import FinanceError, FinanceScope, _digest, _hash
from .finance_observation_contracts import (
    account_snapshot_from_row, require_current_live_native_snapshot,
)
from .finance_policy import SizingPolicy, SizingReceipt, size_intent
from .observation_contracts import InstrumentVersion
from .finance_live_authority import require_live_finance_authority


def _scope(scope: FinanceScope) -> dict:
    return {"environment": scope.environment, "scope_id": scope.scope_id,
            "strategy_account_id": scope.strategy_account_id}


class FinanceSubmissionMixin:
    async def _reservation(self, conn, scope: FinanceScope, reservation_id: str) -> dict:
        row = (await conn.execute(text("""
            SELECT * FROM finance_reservations WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
              AND reservation_id=:id FOR UPDATE
        """), {**_scope(scope), "id": reservation_id})).mappings().first()
        if row is None:
            raise FinanceError("financial reservation is unavailable")
        return dict(row)

    async def verify_possible_submission(
        self, scope: FinanceScope, *, intent_id: str, client_id: str,
        normalized_payload_hash: str, venue_id: str = "hyperliquid",
    ) -> dict | None:
        """Verify a durable live submit marker before a gateway dispatch.

        This is deliberately read-only. The submit marker must already exist from
        mark_submission_started; no caller-supplied snapshot or policy can create
        authority here. Missing, stale, malformed, or non-native state returns
        None so the gateway can fail closed.
        """
        _hash(normalized_payload_hash)
        if not isinstance(intent_id, str) or not intent_id.strip() or len(intent_id) > 256 \
                or not isinstance(client_id, str) or not client_id.strip() \
                or len(client_id) > 256:
            raise FinanceError("submission intent and client identities are required")
        if scope.environment != "live":
            return None
        if venue_id not in {"hyperliquid", "uniswap"}:
            return None

        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT a.attempt_id,a.client_id,a.normalized_payload_hash,
                  r.reservation_id,r.intent_id,r.status AS reservation_status,
                  r.snapshot_hash AS reservation_snapshot_hash,
                  r.policy_version AS reservation_policy_version,
                  r.policy_hash AS reservation_policy_hash,
                  r.authority_epoch AS reservation_authority_epoch,
                  r.authority_fingerprint AS reservation_authority_fingerprint,
                  r.controller_ref AS reservation_controller_ref,
                  r.purpose,r.controller_mode,r.calculation_receipt_hash,
                  c.receipt_json,c.authority_class AS receipt_authority_class,
                  c.policy_hash AS receipt_policy_hash,
                  c.account_revision AS receipt_account_revision,
                  c.observation_snapshot_hash AS receipt_snapshot_hash,
                  i.manifest AS instrument_manifest,
                  i.registry_hash AS instrument_registry_hash,
                  f.admission_state,f.reconciliation_state,f.observation_snapshot_hash,
                  f.policy_version AS account_policy_version,
                  f.policy_hash AS account_policy_hash,
                  f.authority_epoch AS account_authority_epoch,
                  f.source_account_id AS account_source_account_id,
                  EXISTS (SELECT 1 FROM finance_live_uniswap_exit_bindings x
                    WHERE x.environment=a.environment AND x.scope_id=a.scope_id
                      AND x.strategy_account_id=a.strategy_account_id
                      AND x.attempt_id=a.attempt_id
                      AND x.reservation_id=r.reservation_id) AS stopped_exit_binding,
                  p.policy_json,p.policy_hash AS stored_policy_hash,p.approved_live,
                  s.snapshot_hash,s.environment,s.scope_id,s.strategy_account_id,
                  s.source_account_id,s.status,s.origin,s.observed_balances,
                  s.observed_positions,s.balances_complete,s.positions_complete,
                  s.event_at,s.available_at,s.received_at,s.cutoff_at,s.finality,
                  s.finality_at,s.has_gap,s.has_reorg,s.rights_ref,
                  s.source_event_hash,s.source_payload_hash,s.policy_version,
                  s.registry_hash,s.coverage_scope,s.source_block_number,
                  s.source_block_hash,s.created_at,clock_timestamp() AS db_now
                FROM finance_submission_attempts a
                JOIN finance_reservations r USING
                  (environment,scope_id,strategy_account_id,reservation_id)
                JOIN finance_accounts f USING
                  (environment,scope_id,strategy_account_id)
                JOIN finance_policy_versions p ON
                  p.environment=r.environment AND p.scope_id=r.scope_id
                  AND p.strategy_account_id=r.strategy_account_id
                  AND p.policy_version=r.policy_version
                JOIN finance_calculation_receipts c ON
                  c.environment=r.environment AND c.scope_id=r.scope_id
                  AND c.strategy_account_id=r.strategy_account_id
                  AND c.receipt_hash=r.calculation_receipt_hash
                JOIN observation_instrument_versions i ON
                  i.instrument_version_id=p.policy_json->>'instrument_version_id'
                JOIN observation_account_snapshots s
                  ON s.snapshot_hash=f.observation_snapshot_hash
                WHERE a.environment=:environment AND a.scope_id=:scope_id
                  AND a.strategy_account_id=:strategy_account_id
                  AND a.client_id=:client_id
                  AND a.normalized_payload_hash=:payload_hash
                  AND a.status='possible' AND r.intent_id=:intent_id
                  AND r.purpose='trade'
                  AND r.controller_mode IN ('approval_required','autopilot')
                  AND r.status IN ('submitted','uncertain')
            """), {**_scope(scope), "client_id": client_id,
                   "payload_hash": normalized_payload_hash,
                   "intent_id": intent_id})).mappings().first()
        if row is None:
            return None

        try:
            snapshot_fields = (
                "snapshot_hash environment scope_id strategy_account_id source_account_id "
                "status origin observed_balances observed_positions balances_complete "
                "positions_complete event_at available_at received_at cutoff_at finality "
                "finality_at has_gap has_reorg rights_ref source_event_hash "
                "source_payload_hash policy_version registry_hash coverage_scope "
                "source_block_number source_block_hash created_at"
            ).split()
            snapshot = account_snapshot_from_row({
                field: row[field] for field in snapshot_fields
            })
            policy = SizingPolicy.model_validate(row["policy_json"])
            receipt = SizingReceipt.model_validate_json(json.dumps(row["receipt_json"]))
            instrument = InstrumentVersion.model_validate(row["instrument_manifest"])
            db_now = row["db_now"]
            if not isinstance(db_now, datetime):
                return None
            require_current_live_native_snapshot(snapshot, scope=scope,
                source_account_id=row["account_source_account_id"],
                policy_version=policy.policy_version, now=db_now,
                max_age_seconds=policy.max_observation_age_seconds)
            valid = (
                snapshot.scope == scope
                and account_snapshot_hash(snapshot) == snapshot.snapshot_hash
                and (row["admission_state"] == "open" or (
                    row["admission_state"] == "stopped"
                    and row["stopped_exit_binding"] is True
                    and venue_id == "uniswap"
                    and receipt.action == "spot_sell"))
                and row["reconciliation_state"] == "clean"
                and row["observation_snapshot_hash"] == snapshot.snapshot_hash
                and row["reservation_snapshot_hash"] == snapshot.snapshot_hash
                and row["account_policy_version"] == policy.policy_version
                and row["account_policy_hash"] == policy.policy_hash
                and row["reservation_policy_version"] == policy.policy_version
                and row["reservation_policy_hash"] == policy.policy_hash
                and row["stored_policy_hash"] == policy.policy_hash
                and row["approved_live"] is True and policy.approved_live is True
                and row["account_authority_epoch"] == row["reservation_authority_epoch"]
                and row["receipt_authority_class"] == "live_native"
                and row["receipt_policy_hash"] == policy.policy_hash
                and row["receipt_account_revision"] == int(receipt.account_revision)
                and row["receipt_snapshot_hash"] == snapshot.snapshot_hash
                and row["calculation_receipt_hash"] == receipt.receipt_hash
                and size_intent(policy, receipt.request,
                                    row["receipt_account_revision"]) == receipt
                and receipt.policy_hash == policy.policy_hash
                and receipt.policy_version == policy.policy_version
                and receipt.account_snapshot_hash == snapshot.snapshot_hash
                and receipt.instrument_version_id == policy.instrument_version_id
                and receipt.request.instrument_version_id == instrument.instrument_version_id
                and instrument.instrument_version_id == policy.instrument_version_id
                and instrument.registry_hash == row["instrument_registry_hash"]
                and instrument.venue_id == venue_id
                and (venue_id != "uniswap" or (
                    instrument.product_kind == "spot"
                    and receipt.action in {"spot_buy", "spot_sell"}
                    and snapshot.coverage_scope == "arbitrum_usdc_weth_spot"))
            )
        except (FinanceError, ValidationError, KeyError, TypeError, ValueError):
            return None
        if not valid:
            return None
        return {
            "attemptId": row["attempt_id"],
            "reservationId": row["reservation_id"],
            "intentId": row["intent_id"],
            "clientId": row["client_id"],
            "normalizedPayloadHash": row["normalized_payload_hash"],
            "snapshotHash": snapshot.snapshot_hash,
            "strategyAccountId": scope.strategy_account_id,
            "sourceAccountId": snapshot.source_account_id,
            "policyVersion": policy.policy_version,
            "policyHash": policy.policy_hash,
            "authorityEpoch": row["reservation_authority_epoch"],
            "instrumentVersionId": instrument.instrument_version_id,
            "venueId": instrument.venue_id,
            "nativeInstrumentId": instrument.native_instrument_id,
            "productKind": instrument.product_kind,
            "baseAssetUnitId": instrument.base_asset_unit_id,
            "quoteAssetUnitId": instrument.quote_asset_unit_id,
            "baseDecimals": instrument.base_decimals,
            "quoteDecimals": instrument.quote_decimals,
            "quantityUnits": receipt.quantity_units,
            "notionalUnits": receipt.notional_units,
            "priceNumerator": receipt.request.quote_per_quantity_numerator,
            "priceDenominator": receipt.request.quote_per_quantity_denominator,
            "action": receipt.action,
            "calculationReceiptHash": receipt.receipt_hash,
            "authorityFingerprint": row["reservation_authority_fingerprint"],
            "reservationControllerRef": row["reservation_controller_ref"],
        }

    async def mark_submission_started(
        self, scope: FinanceScope, reservation_id: str, client_id: str,
        normalized_payload_hash: str, writer_epoch: int, authority_epoch: int,
        expected_revision: int, idempotency_key: str,
    ) -> dict:
        _hash(normalized_payload_hash)
        if not client_id or not idempotency_key:
            raise FinanceError("submission client and idempotency identities are required")
        request_hash = _digest("moeazi-finance-command-v1:submission-start", {
            "scope": scope.model_dump(), "reservationId": reservation_id,
            "clientId": client_id, "normalizedPayloadHash": normalized_payload_hash})
        async with self.engine.begin() as conn:
            account = await self._lock(conn, scope)
            prior = await self._claim(conn, scope, "submission_start",
                                      idempotency_key, request_hash)
            if prior:
                return {"attemptId": prior["result_id"],
                        "revision": prior["account_revision"], "status": "possible"}
            now = await self._writer(conn, account, writer_epoch)
            self._revision(account, expected_revision)
            reservation = await self._reservation(conn, scope, reservation_id)
            view = await self._read_state(conn, scope, account, now)
            if account["admission_state"] != "open" or account["authority_epoch"] != authority_epoch \
                    or reservation["authority_epoch"] != authority_epoch \
                    or reservation["status"] != "reserved" or reservation["expires_at"] <= now \
                    or view["reconciliation_state"] != "clean" \
                    or reservation["snapshot_hash"] != account["observation_snapshot_hash"] \
                    or reservation["policy_hash"] != account["policy_hash"]:
                raise FinanceError("submission admission expired or authority changed")
            if scope.environment == "live":
                policy = await self._receipt_policy(conn, scope,
                    reservation["policy_version"])
                if policy.policy_hash != reservation["policy_hash"]:
                    raise FinanceError("live submission policy changed")
                await require_live_finance_authority(conn, scope, account,
                    policy, now)
            attempt_id = sha256(("finance-attempt-v1:" + scope.environment + ":"
                + scope.scope_id + ":" + scope.strategy_account_id + ":" + client_id).encode()).hexdigest()
            await conn.execute(text("""
                INSERT INTO finance_submission_attempts(environment,scope_id,
                  strategy_account_id,attempt_id,reservation_id,client_id,
                  normalized_payload_hash,status)
                VALUES(:environment,:scope_id,:strategy_account_id,:attempt,:reservation,
                  :client,:payload,'possible')
            """), {**_scope(scope), "attempt": attempt_id,
                   "reservation": reservation_id, "client": client_id,
                   "payload": normalized_payload_hash})
            await conn.execute(text("""
                UPDATE finance_reservations SET status='submitted',
                  retention_reason='possible_submission',updated_at=clock_timestamp()
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND reservation_id=:id
            """), {**_scope(scope), "id": reservation_id})
            updated = await self._advance(conn, scope, writer_epoch, account)
            await self._insert_claim(conn, scope, "submission_start", idempotency_key,
                                     request_hash, attempt_id, updated["revision"])
            await self._outbox(conn, scope, updated)
            return {"attemptId": attempt_id, "revision": updated["revision"],
                    "status": "possible"}

    async def mark_submission_uncertain(
        self, scope: FinanceScope, reservation_id: str, writer_epoch: int,
        expected_revision: int, idempotency_key: str,
    ) -> dict:
        request_hash = _digest("moeazi-finance-command-v1:submission-uncertain", {
            "scope": scope.model_dump(), "reservationId": reservation_id})
        async with self.engine.begin() as conn:
            account = await self._lock(conn, scope)
            old = await self._claim(conn, scope, "submission_uncertain",
                                    idempotency_key, request_hash)
            if old:
                return {"reservationId": reservation_id,
                        "revision": old["account_revision"], "status": "uncertain"}
            await self._writer(conn, account, writer_epoch)
            self._revision(account, expected_revision)
            reservation = await self._reservation(conn, scope, reservation_id)
            if reservation["status"] != "submitted":
                raise FinanceError("only a submitted reservation can become uncertain")
            await conn.execute(text("""
                UPDATE finance_reservations SET status='uncertain',
                  retention_reason='submission_outcome_unknown',updated_at=clock_timestamp()
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND reservation_id=:id
            """), {**_scope(scope), "id": reservation_id})
            updated = await self._advance(conn, scope, writer_epoch, account)
            await self._insert_claim(conn, scope, "submission_uncertain", idempotency_key,
                                     request_hash, reservation_id, updated["revision"])
            await self._outbox(conn, scope, updated)
            return {"reservationId": reservation_id,
                    "revision": updated["revision"], "status": "uncertain"}

    async def release_expired_unsubmitted(
        self, scope: FinanceScope, reservation_id: str, writer_epoch: int,
        expected_revision: int, idempotency_key: str,
    ) -> dict:
        request_hash = _digest("moeazi-finance-command-v1:expiry-release", {
            "scope": scope.model_dump(), "reservationId": reservation_id})
        async with self.engine.begin() as conn:
            account = await self._lock(conn, scope)
            old = await self._claim(conn, scope, "expiry_release",
                                    idempotency_key, request_hash)
            if old:
                return {"reservationId": reservation_id,
                        "revision": old["account_revision"], "status": "released"}
            now = await self._writer(conn, account, writer_epoch)
            self._revision(account, expected_revision)
            reservation = await self._reservation(conn, scope, reservation_id)
            attempt = (await conn.execute(text("""
                SELECT 1 FROM finance_submission_attempts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND reservation_id=:id LIMIT 1
            """), {**_scope(scope), "id": reservation_id})).first()
            if reservation["status"] != "reserved" or reservation["expires_at"] > now or attempt:
                raise FinanceError("possible submission cannot be released by expiry")
            await conn.execute(text("""
                UPDATE finance_reservations SET status='released',
                  retention_reason=NULL,updated_at=clock_timestamp()
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND reservation_id=:id
            """), {**_scope(scope), "id": reservation_id})
            updated = await self._advance(conn, scope, writer_epoch, account)
            await self._insert_claim(conn, scope, "expiry_release", idempotency_key,
                                     request_hash, reservation_id, updated["revision"])
            await self._outbox(conn, scope, updated)
            return {"reservationId": reservation_id,
                    "revision": updated["revision"], "status": "released"}
