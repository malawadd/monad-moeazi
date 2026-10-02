"""Immutable intent facts and scoped, revocable simulation-only approvals."""
from __future__ import annotations

from datetime import datetime
import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest, _hash, _utc
from .lifecycle_contracts import TradeIntent
from .lifecycle_decision import ReplayDecisionContext
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params


class LifecycleIntentMixin:
    async def persist_intent(self, intent: TradeIntent) -> dict:
        intent = TradeIntent.model_validate_json(intent.model_dump_json())
        scope = intent.scope
        params = _run_params(scope, intent.run_id)
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, intent.run_id, lock=True)
            manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
            if run["manifest_hash"] != intent.run_manifest_hash or \
                    manifest.controller_ref != intent.controller_ref or \
                    manifest.controller_mode != intent.controller_mode or \
                    manifest.strategy_artifact_hash != intent.strategy_artifact_hash or \
                    intent.instrument_version_id not in manifest.instrument_version_ids or \
                    intent.expires_at_cursor > manifest.scenario.simulation_end_at:
                raise FinanceError("intent differs from the immutable simulation run")
            prior = (await conn.execute(text("""
                SELECT intent_hash FROM simulation_intents WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND intent_id=:intent_id
            """), {**params, "intent_id": intent.intent_id})).scalar_one_or_none()
            if prior is not None:
                if prior != intent.intent_hash:
                    raise FinanceError("simulation intent identity conflicts")
                return {"intentId": intent.intent_id, "intentHash": prior, "status": "duplicate"}
            if intent.decision_context_hash is None:
                if run["replay_cursor_at"] != manifest.scenario.simulation_cursor_at or \
                        account["observation_snapshot_hash"] != \
                        manifest.account_snapshot_hash or \
                        intent.evidence_snapshot_hash != manifest.evidence_snapshot_hash:
                    raise FinanceError("initial intent cannot borrow later replay state")
                cursor = manifest.scenario.simulation_cursor_at
            else:
                stored = (await conn.execute(text("""
                    SELECT decision_json FROM simulation_decision_contexts
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                      AND decision_hash=:hash
                """), {**params, "hash": intent.decision_context_hash})).scalar_one_or_none()
                if stored is None:
                    raise FinanceError("later intent lacks a persisted replay decision")
                decision = ReplayDecisionContext.model_validate_json(json.dumps(stored))
                if decision.decision_hash != intent.decision_context_hash or \
                        decision.scope != scope or decision.run_id != intent.run_id or \
                        decision.run_manifest_hash != manifest.manifest_hash or \
                        decision.controller_ref != manifest.controller_ref or \
                        decision.instrument_version_id != intent.instrument_version_id or \
                        decision.evidence_snapshot_hash != intent.evidence_snapshot_hash or \
                        decision.account_snapshot_hash != \
                        account["observation_snapshot_hash"] or \
                        decision.cursor_at != run["replay_cursor_at"]:
                    raise FinanceError("later intent decision or account checkpoint changed")
                cursor = decision.cursor_at
            if intent.expires_at_cursor <= cursor:
                raise FinanceError("intent expired before current replay cursor")
            await conn.execute(text("""
                INSERT INTO simulation_intents(environment,scope_id,strategy_account_id,
                  run_id,intent_id,intent_hash,intent_json)
                VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
                  :intent_id,:intent_hash,CAST(:intent_json AS jsonb))
            """), {**params, "intent_id": intent.intent_id, "intent_hash": intent.intent_hash,
                   "intent_json": json.dumps(intent.model_dump(mode="json"),
                                             sort_keys=True, separators=(",", ":"),
                                             ensure_ascii=False)})
            return {"intentId": intent.intent_id, "intentHash": intent.intent_hash,
                    "status": "recorded"}

    async def record_simulation_approval(self, scope: FinanceScope, run_id: str,
                                         manifest_hash: str, intent_id: str,
                                         normalized_payload_hash: str,
                                         approved_by_subject: str, expires_at: datetime,
                                         command_id: str) -> dict:
        _hash(manifest_hash)
        _hash(normalized_payload_hash)
        expires_at = _utc(expires_at)
        if not intent_id or not approved_by_subject or not command_id:
            raise FinanceError("approval requires exact intent, actor, and command")
        params = _run_params(scope, run_id)
        async with self.finance.engine.begin() as conn:
            await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
            if run["manifest_hash"] != manifest_hash or \
                    manifest.controller_mode != "approval_required" or \
                    run["entries_stopped"] or run["status"] == "completed_flat" or \
                    approved_by_subject != run["created_by_subject"]:
                raise FinanceError("simulation approval has no current owner or mode")
            intent = (await conn.execute(text("""
                SELECT intent_hash,intent_json FROM simulation_intents
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND intent_id=:intent_id
            """), {**params, "intent_id": intent_id})).mappings().first()
            if not intent:
                raise FinanceError("approval cannot authorize a missing or hold intent")
            stored_intent = TradeIntent.model_validate_json(json.dumps(intent["intent_json"]))
            if stored_intent.intent_hash != intent["intent_hash"] or \
                    stored_intent.action == "hold":
                raise FinanceError("approval cannot authorize a changed or hold intent")
            preparation = (await conn.execute(text("""
                SELECT normalized_payload_json FROM simulation_order_preparations
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND intent_id=:intent_id AND intent_hash=:intent_hash
                  AND normalized_payload_hash=:payload
            """), {**params, "intent_id": intent_id,
                   "intent_hash": intent["intent_hash"],
                   "payload": normalized_payload_hash})).mappings().first()
            if preparation is None:
                raise FinanceError("approval payload was not prepared by the server")
            prepared = preparation["normalized_payload_json"]
            if prepared.get("normalizedPayloadHash") != normalized_payload_hash or \
                    _digest("moeazi-simulation-order-payload-v1", {
                        key: value for key, value in prepared.items()
                        if key != "normalizedPayloadHash"}) != normalized_payload_hash:
                raise FinanceError("prepared approval payload hash differs")
            prior = (await conn.execute(text("""
                SELECT approval_hash,intent_id,intent_hash,normalized_payload_hash,
                  approved_by_subject,expires_at FROM simulation_approval_receipts
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND command_id=:command_id
            """), {**params, "command_id": command_id})).mappings().first()
            if prior:
                if prior["intent_id"] != intent_id or prior["intent_hash"] != \
                        intent["intent_hash"] or prior["normalized_payload_hash"] != \
                        normalized_payload_hash or prior["approved_by_subject"] != \
                        approved_by_subject or prior["expires_at"] != expires_at:
                    raise FinanceError("simulation approval command identity conflicts")
                return {"approvalReceiptHash": prior["approval_hash"], "status": "duplicate"}
            now = await self.finance._db_now(conn)
            seconds = (expires_at - now).total_seconds()
            if seconds <= 0 or seconds > 3600:
                raise FinanceError("simulation approval expiry is outside one hour")
            body = {"schemaVersion": 1, "scope": scope.model_dump(mode="json"),
                    "runId": run_id, "manifestHash": manifest_hash,
                    "intentId": intent_id, "intentHash": intent["intent_hash"],
                    "normalizedPayloadHash": normalized_payload_hash,
                    "approvedBySubject": approved_by_subject,
                    "approvedAt": now.isoformat(), "expiresAt": expires_at.isoformat(),
                    "commandId": command_id}
            digest = _digest("moeazi-simulation-approval-v1", body)
            await conn.execute(text("""
                INSERT INTO simulation_approval_receipts(environment,scope_id,
                  strategy_account_id,run_id,approval_hash,command_id,intent_id,
                  intent_hash,normalized_payload_hash,approved_by_subject,
                  approved_at,expires_at,approval_json)
                VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
                  :approval_hash,:command_id,:intent_id,:intent_hash,:payload,
                  :actor,:approved_at,:expires_at,CAST(:approval_json AS jsonb))
            """), {**params, "approval_hash": digest, "command_id": command_id,
                   "intent_id": intent_id, "intent_hash": intent["intent_hash"],
                   "payload": normalized_payload_hash, "actor": approved_by_subject,
                   "approved_at": now, "expires_at": expires_at,
                   "approval_json": json.dumps(body | {"approvalHash": digest},
                                               sort_keys=True, separators=(",", ":"),
                                               ensure_ascii=False)})
            return {"approvalReceiptHash": digest, "status": "recorded"}

    async def revoke_simulation_approval(self, scope: FinanceScope, run_id: str,
                                         manifest_hash: str, approval_hash: str,
                                         revoked_by_subject: str) -> dict:
        _hash(manifest_hash)
        _hash(approval_hash)
        params = _run_params(scope, run_id)
        async with self.finance.engine.begin() as conn:
            await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            if run["manifest_hash"] != manifest_hash or \
                    run["created_by_subject"] != revoked_by_subject:
                raise FinanceError("simulation approval revocation owner differs")
            approval = (await conn.execute(text("""
                SELECT intent_hash,normalized_payload_hash FROM simulation_approval_receipts
                WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND approval_hash=:hash
            """), {**params, "hash": approval_hash})).mappings().first()
            if approval is None:
                raise FinanceError("simulation approval receipt is unavailable")
            already = (await conn.execute(text("""
                SELECT 1 FROM simulation_approval_revocations
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND approval_hash=:hash
            """), {**params, "hash": approval_hash})).first()
            if already:
                return {"approvalReceiptHash": approval_hash, "status": "revoked"}
            # A revocation covers every approval for this prepared economic
            # payload that existed before the serialized revocation. A future
            # explicit approval command may grant a new receipt.
            await conn.execute(text("""
                INSERT INTO simulation_approval_revocations(environment,scope_id,
                  strategy_account_id,run_id,approval_hash,revoked_by_subject)
                SELECT a.environment,a.scope_id,a.strategy_account_id,a.run_id,
                  a.approval_hash,:actor FROM simulation_approval_receipts a
                WHERE a.environment=:environment AND a.scope_id=:scope_id
                  AND a.strategy_account_id=:strategy_account_id AND a.run_id=:run_id
                  AND a.intent_hash=:intent_hash AND
                  a.normalized_payload_hash=:payload_hash
                ON CONFLICT DO NOTHING
            """), {**params, "intent_hash": approval["intent_hash"],
                   "payload_hash": approval["normalized_payload_hash"],
                   "actor": revoked_by_subject})
            return {"approvalReceiptHash": approval_hash, "status": "revoked"}
