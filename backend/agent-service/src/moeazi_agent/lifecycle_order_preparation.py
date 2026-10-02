"""Prepare one server-derived simulated order from a committed financial hold."""
from __future__ import annotations

from hashlib import sha256
from fractions import Fraction
import json

from sqlalchemy import text

from .finance_contracts import FinanceError, _digest, native_int
from .finance_policy import SizingReceipt
from .lifecycle_contracts import TradeIntent
from .lifecycle_order_decision import resolve_order_decision
from .lifecycle_order_maintenance import (
    maintenance_for_intent, verify_maintenance,
)
from .lifecycle_order_replay_receipt import check_replay_preparation_receipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .lifecycle_state import EntryAuthorizationRequest
from .observation_contracts import InstrumentVersion


def _stable_id(label: str, *parts: str) -> str:
    return sha256((label + ":" + ":".join(parts)).encode("utf-8")).hexdigest()


class LifecycleOrderPreparationMixin:
    async def prepare_order(self, intent: TradeIntent, reservation_id: str,
                            order_ordinal: int, *, worker_id: str,
                            command_id: str) -> dict:
        intent = TradeIntent.model_validate_json(intent.model_dump_json())
        if intent.action == "hold" or \
                type(order_ordinal) is not int or order_ordinal <= 0 or \
                not worker_id or not command_id:
            raise FinanceError("only a stable experimental order can be prepared")
        scope = intent.scope
        params = _run_params(scope, intent.run_id)
        # A duplicate preparation is a read of committed identity, not a fresh entry.
        async with self.finance.engine.connect() as conn:
            run = await self._run(conn, scope, intent.run_id, lock=False)
            maintenance = await maintenance_for_intent(conn, scope, intent.run_id,
                intent.intent_id, reservation_id)
            if intent.maintenance_command_hash is not None and maintenance is None:
                raise FinanceError("maintenance intent has no exact owner close mandate")
            order_id = (maintenance.maintenance_order_id if maintenance else
                _stable_id("simulation-order-v1", scope.environment,
                    scope.scope_id, scope.strategy_account_id, intent.run_id,
                    intent.intent_id, str(order_ordinal)))
            client_id = _stable_id("simulation-client-v1", scope.environment,
                scope.scope_id, scope.strategy_account_id, intent.run_id, order_id)
            attempt_id = _stable_id("finance-attempt-v1", scope.environment,
                scope.scope_id, scope.strategy_account_id, client_id)
            existing = (await conn.execute(text("""
                SELECT * FROM simulation_order_preparations WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND order_id=:order_id
            """), {**params, "order_id": order_id})).mappings().first()
            if existing:
                if existing["intent_hash"] != intent.intent_hash or \
                        existing["reservation_id"] != reservation_id or \
                        existing["order_ordinal"] != order_ordinal:
                    raise FinanceError("prepared order identity conflicts")
                return {"orderId": order_id, "clientId": existing["client_id"],
                        "attemptId": existing["attempt_id"],
                        "normalizedPayloadHash": existing["normalized_payload_hash"],
                        "status": "duplicate"}
        if maintenance is None and self.entry_authorizer is None:
            raise FinanceError("new simulated entry has no fresh product authorizer")
        manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
        request = EntryAuthorizationRequest(schema_version=1, scope=scope,
            run_id=intent.run_id, manifest_hash=manifest.manifest_hash,
            created_by_subject=run["created_by_subject"],
            experiment_request_hash=run["experiment_request_hash"],
            controller_ref=manifest.controller_ref, controller_mode=manifest.controller_mode,
            registered_authority_fingerprint=run["authority_fingerprint"],
            authority_epoch=run["authority_epoch"])
        fresh = await self.entry_authorizer(request) if maintenance is None else None
        if fresh is not None and (fresh.scope != request.scope or fresh.run_id != request.run_id or \
                fresh.controller_ref != request.controller_ref or \
                fresh.controller_mode != request.controller_mode or \
                fresh.created_by_subject != request.created_by_subject or \
                fresh.experiment_request_hash != request.experiment_request_hash or \
                fresh.authority_fingerprint != request.registered_authority_fingerprint):
            raise FinanceError("fresh product authority differs from persisted run")
        writer_epoch = await self.finance.acquire_writer_epoch(scope, worker_id)
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, intent.run_id, lock=True)
            now = await self.finance._writer(conn, account, writer_epoch)
            age_seconds = (now - fresh.checked_at).total_seconds() if fresh else 0
            if fresh and (age_seconds < 0 or age_seconds > 5):
                raise FinanceError(f"fresh product identity was delayed or is in the future ({age_seconds:.3f}s)")
            if run["manifest_hash"] != manifest.manifest_hash or \
                    (fresh and run["authority_fingerprint"] != fresh.authority_fingerprint) or \
                    (maintenance is None and (run["authority_epoch"] != account["authority_epoch"] or
                     run["entries_stopped"] or account["admission_state"] != "open")) or \
                    run["status"] == "completed_flat" or \
                    account["reconciliation_state"] != "clean" or \
                    account["policy_hash"] != manifest.policy_hash or \
                    account["policy_version"] != manifest.policy_version:
                raise FinanceError("simulation entry authority or financial state changed")
            if manifest.controller_ref != intent.controller_ref or \
                    manifest.controller_mode != intent.controller_mode or \
                    manifest.manifest_hash != intent.run_manifest_hash or \
                    manifest.strategy_artifact_hash != intent.strategy_artifact_hash or \
                    intent.calculation_receipt_hash is None or \
                    intent.instrument_version_id not in manifest.instrument_version_ids:
                raise FinanceError("intent differs from registered run or lacks sizing")
            recorded_intent = (await conn.execute(text("""
                SELECT intent_hash,intent_json FROM simulation_intents WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND intent_id=:intent_id
            """), {**params, "intent_id": intent.intent_id})).mappings().first()
            if not recorded_intent or recorded_intent["intent_hash"] != intent.intent_hash or \
                    TradeIntent.model_validate_json(json.dumps(
                        recorded_intent["intent_json"])) != intent:
                raise FinanceError("order requires a persisted exact intent")
            context, selected_book = await resolve_order_decision(
                conn, manifest, run, account, intent)
            previous = (await conn.execute(text("""
                SELECT * FROM simulation_order_preparations WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND order_id=:order_id
            """), {**params, "order_id": order_id})).mappings().first()
            if previous:
                if previous["intent_hash"] != intent.intent_hash or \
                        previous["reservation_id"] != reservation_id:
                    raise FinanceError("prepared order identity conflicts")
                return {"orderId": order_id, "clientId": previous["client_id"],
                        "attemptId": previous["attempt_id"],
                        "normalizedPayloadHash": previous["normalized_payload_hash"],
                        "status": "duplicate"}
            reservation = await self.finance._reservation(conn, scope, reservation_id)
            if reservation["status"] != "reserved" or reservation["expires_at"] <= now or \
                    reservation["intent_id"] != intent.intent_id or \
                    reservation["calculation_receipt_hash"] != intent.calculation_receipt_hash or \
                    reservation["controller_ref"] != intent.controller_ref.model_dump() or \
                    reservation["controller_mode"] != intent.controller_mode or \
                    reservation["authority_epoch"] != account["authority_epoch"] or \
                    (fresh and reservation["authority_fingerprint"] != fresh.authority_fingerprint) or \
                    reservation["snapshot_hash"] != account["observation_snapshot_hash"] or \
                    reservation["policy_hash"] != manifest.policy_hash or \
                    reservation["policy_version"] != manifest.policy_version:
                raise FinanceError("order reservation changed or expired")
            if maintenance is not None:
                current = await maintenance_for_intent(conn, scope, intent.run_id,
                    intent.intent_id, reservation_id)
                if current != maintenance:
                    raise FinanceError("maintenance mandate changed before preparation")
                await verify_maintenance(conn, manifest, run, account, intent,
                    reservation, maintenance, order_id=order_id)
            receipt_row = (await conn.execute(text("""
                SELECT receipt_json FROM finance_calculation_receipts
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND receipt_hash=:hash
            """), {**params, "hash": intent.calculation_receipt_hash})).mappings().first()
            if receipt_row is None:
                raise FinanceError("stored sizing receipt is missing")
            replay = receipt_row["receipt_json"].get("code_version") in {
                "replay-sizing-v1", "replay-sizing-v2"}
            if replay:
                receipt = await check_replay_preparation_receipt(conn, params,
                    receipt_row["receipt_json"], intent.calculation_receipt_hash,
                    intent, manifest, account, run, reservation, context,
                    selected_book, order_ordinal)
                if maintenance is not None and (
                        receipt.code_version != "replay-sizing-v2" or
                        receipt.request_id != "maintenance:" + maintenance.command_hash or
                        receipt.execution_envelope is None or
                        receipt.execution_envelope.envelope_hash !=
                            maintenance.execution_envelope_hash or
                        receipt.position_state_hash != maintenance.position_state_hash or
                        receipt.position_revision != maintenance.position_revision or
                        receipt.quantity_units != maintenance.quantity_units):
                    raise FinanceError("maintenance sizing differs from owner close")
                quantity_asset, quantity_registry = (receipt.base_asset_unit_id,
                    receipt.base_registry_hash)
                quote_asset, quote_registry = (receipt.quote_asset_unit_id,
                    receipt.quote_registry_hash)
                place, numerator, denominator = (receipt.location_id,
                    receipt.price_numerator, receipt.price_denominator)
            else:
                if intent.action not in {"spot_buy", "spot_sell"}:
                    raise FinanceError("legacy sizing covers spot orders only")
                receipt = SizingReceipt.model_validate_json(
                    json.dumps(receipt_row["receipt_json"]))
                if receipt.receipt_hash != intent.calculation_receipt_hash or \
                        receipt.action != intent.action or \
                        receipt.instrument_version_id != intent.instrument_version_id or \
                        receipt.price_snapshot_hash != intent.evidence_snapshot_hash or \
                        receipt.account_snapshot_hash != account["observation_snapshot_hash"] or \
                        receipt.policy_hash != manifest.policy_hash or \
                        native_int(receipt.quantity_units) > native_int(intent.desired_quantity_units):
                    raise FinanceError("prepared quantity differs from verified receipt")
                quantity_asset, quantity_registry = (receipt.request.quantity_asset_unit_id,
                    receipt.request.quantity_registry_hash)
                quote_asset, quote_registry = (receipt.request.quote_asset_unit_id,
                    receipt.request.quote_registry_hash)
                place, numerator, denominator = (receipt.request.location_id,
                    receipt.request.quote_per_quantity_numerator,
                    receipt.request.quote_per_quantity_denominator)
            registry = (await conn.execute(text("""
                SELECT manifest,registry_hash FROM observation_instrument_versions
                WHERE instrument_version_id=:id
            """), {"id": intent.instrument_version_id})).mappings().first()
            if registry is None:
                raise FinanceError("prepared order instrument is unregistered")
            instrument = InstrumentVersion.model_validate(registry["manifest"])
            if instrument.registry_hash != intent.instrument_registry_hash or \
                    instrument.registry_hash != registry["registry_hash"] or \
                    (replay and (receipt.base_asset_unit_id !=
                        instrument.base_asset_unit_id or receipt.quote_asset_unit_id !=
                        instrument.quote_asset_unit_id or receipt.settlement_asset_unit_id !=
                        instrument.settlement_asset_unit_id)):
                raise FinanceError("prepared instrument identity differs")
            if replay:
                contract_size = Fraction(instrument.contract_multiplier) * \
                    10 ** instrument.base_decimals
                if (receipt.quantity_kind == "asset_native" and
                        (instrument.product_kind != "spot" or
                         receipt.contract_size_units is not None)) or \
                        (receipt.quantity_kind == "contracts" and
                         (instrument.product_kind != "perpetual" or
                          instrument.margin_model != "linear_v1" or
                          contract_size.denominator != 1 or
                          receipt.contract_size_unit_id !=
                            instrument.base_asset_unit_id or
                          receipt.contract_size_units != str(contract_size.numerator))):
                    raise FinanceError("prepared action lacks qualified instrument model")
            elif instrument.product_kind != "spot":
                raise FinanceError("legacy receipt cannot prepare a perpetual")
            # Stage 2's receipt reserves quote-denominated fees only. A distinct
            # fee asset needs a dedicated additional hold before Q4 admission.
            if not replay and any(rule.order_ordinal == order_ordinal and native_int(rule.units) > 0 and
                   rule.asset_unit_id != receipt.request.quote_asset_unit_id
                   for rule in manifest.scenario.fee_rules):
                raise FinanceError("third-asset fee capacity is not yet reserved")
            body = {"schemaVersion": 1, "scope": scope.model_dump(mode="json"),
                    "runId": intent.run_id, "manifestHash": manifest.manifest_hash,
                    "scenarioHash": manifest.scenario.scenario_hash,
                    "orderId": order_id, "orderOrdinal": order_ordinal,
                    "clientId": client_id, "attemptId": attempt_id,
                    "intentId": intent.intent_id, "intentHash": intent.intent_hash,
                    "reservationId": reservation_id,
                    "calculationReceiptHash": receipt.receipt_hash,
                    "instrumentVersionId": instrument.instrument_version_id,
                    "instrumentRegistryHash": instrument.registry_hash,
                    "action": intent.action, "side": intent.side,
                    "quantityUnits": receipt.quantity_units,
                    "locationId": place,
                    "quantityAssetUnitId": quantity_asset,
                    "quantityRegistryHash": quantity_registry,
                    "quoteAssetUnitId": quote_asset,
                    "quoteRegistryHash": quote_registry,
                    "priceNumerator": numerator,
                    "priceDenominator": denominator,
                    "evidenceSnapshotHash": intent.evidence_snapshot_hash,
                    "decisionContextHash": intent.decision_context_hash,
                    "accountSnapshotHash": account["observation_snapshot_hash"],
                    "policyHash": manifest.policy_hash}
            if replay:
                body.update(receiptCodeVersion=receipt.code_version,
                    quantityKind=receipt.quantity_kind,
                    contractSizeUnitId=receipt.contract_size_unit_id,
                    contractSizeUnits=receipt.contract_size_units,
                    settlementAssetUnitId=receipt.settlement_asset_unit_id,
                    settlementRegistryHash=receipt.settlement_registry_hash,
                    notionalUnits=receipt.notional_units,
                    riskNotionalUnits=receipt.risk_notional_units,
                    targetExposureUnits=receipt.target_exposure_units,
                    feeBudgetQuoteUnits=receipt.fee_budget_quote_units,
                    reservationComponents=[part.model_dump(mode="json")
                                           for part in receipt.components])
                if receipt.code_version == "replay-sizing-v2":
                    if receipt.execution_envelope is None:
                        raise FinanceError("causal preparation lacks its held envelope")
                    body["executionEnvelopeHash"] = \
                        receipt.execution_envelope.envelope_hash
            digest = _digest("moeazi-simulation-order-payload-v1", body)
            await conn.execute(text("""
                INSERT INTO simulation_order_preparations(environment,scope_id,
                  strategy_account_id,run_id,order_id,order_ordinal,intent_id,intent_hash,
                  reservation_id,calculation_receipt_hash,normalized_payload_hash,
                  normalized_payload_json,client_id,attempt_id,quantity_units)
                VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:order_id,
                  :order_ordinal,:intent_id,:intent_hash,:reservation_id,:receipt,
                  :digest,CAST(:payload AS jsonb),:client_id,:attempt_id,:quantity)
            """), {**params, "order_id": order_id, "order_ordinal": order_ordinal,
                   "intent_id": intent.intent_id, "intent_hash": intent.intent_hash,
                   "reservation_id": reservation_id, "receipt": receipt.receipt_hash,
                   "digest": digest, "payload": json.dumps(body | {
                       "normalizedPayloadHash": digest}, sort_keys=True,
                       separators=(",", ":"), ensure_ascii=False),
                   "client_id": client_id, "attempt_id": attempt_id,
                   "quantity": receipt.quantity_units})
            return {"orderId": order_id, "clientId": client_id,
                    "attemptId": attempt_id, "normalizedPayloadHash": digest,
                    "status": "prepared"}
