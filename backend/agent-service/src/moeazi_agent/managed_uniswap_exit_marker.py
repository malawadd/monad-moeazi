"""Read-only proof of one stopped-account, WETH-backed exit submission."""
from __future__ import annotations

import json
from datetime import datetime

from pydantic import ValidationError
from sqlalchemy import text

from .account_observation_storage import account_snapshot_hash
from .finance_contracts import FinanceError, FinanceScope, _hash, native_int
from .finance_market_evidence import resolve_sizing_request
from .finance_observation_contracts import (
    ARBITRUM_MANAGED_PAIR_COVERAGE, account_snapshot_from_row,
    require_current_live_native_snapshot,
)
from .finance_policy import SizingPolicy, SizingReceipt, size_intent
from .finance_uniswap_quote import load_uniswap_quote
from .observation_contracts import InstrumentVersion


async def verify_stopped_uniswap_exit_submission(finance, scope: FinanceScope, *,
        intent_id: str, client_id: str, normalized_payload_hash: str,
        grant_id: str, assignment_id: str) -> dict | None:
    """Gateway marker verification only; it never claims or creates an attempt."""
    _hash(normalized_payload_hash)
    if scope.environment != "live" or scope.scope_id != "live" or not all(
            isinstance(v, str) and v for v in
            (intent_id, client_id, grant_id, assignment_id)):
        return None
    async with finance.engine.connect() as conn:
        row = (await conn.execute(text("""
          SELECT b.*,a.status AS attempt_status,r.status AS hold_status,
            r.snapshot_hash AS hold_snapshot_hash,r.policy_hash AS hold_policy_hash,
            r.policy_version AS hold_policy_version,r.authority_epoch AS hold_authority_epoch,
            r.authority_fingerprint,r.controller_ref AS hold_controller_ref,
            r.controller_mode,r.purpose,r.calculation_receipt_hash,r.expires_at,
            f.admission_state,f.reconciliation_state,
            f.observation_snapshot_hash AS account_snapshot_hash,
            f.source_account_id,f.policy_version AS account_policy_version,
            f.policy_hash AS account_policy_hash,f.authority_epoch AS account_authority_epoch,
            c.receipt_json,c.authority_class,c.account_revision AS receipt_revision,
            p.policy_json,p.policy_hash AS stored_policy_hash,p.approved_live,
            i.manifest AS instrument_manifest,i.registry_hash AS instrument_registry_hash,
            s.snapshot_hash,s.environment AS snapshot_environment,
            s.scope_id AS snapshot_scope_id,s.strategy_account_id AS snapshot_account_id,
            s.source_account_id AS snapshot_source_account_id,s.status,s.origin,
            s.observed_balances,s.observed_positions,s.balances_complete,
            s.positions_complete,s.event_at,s.available_at,s.received_at,
            s.cutoff_at,s.finality,s.finality_at,s.has_gap,s.has_reorg,s.rights_ref,
            s.source_event_hash,s.source_payload_hash,s.policy_version AS snapshot_policy_version,
            s.registry_hash,s.created_at,s.coverage_scope,s.source_block_number,
            s.source_block_hash,clock_timestamp() AS db_now
          FROM finance_live_uniswap_exit_bindings b
          JOIN finance_submission_attempts a USING
            (environment,scope_id,strategy_account_id,attempt_id)
          JOIN finance_reservations r USING
            (environment,scope_id,strategy_account_id,reservation_id)
          JOIN finance_accounts f USING (environment,scope_id,strategy_account_id)
          JOIN finance_calculation_receipts c ON c.environment=r.environment
            AND c.scope_id=r.scope_id AND c.strategy_account_id=r.strategy_account_id
            AND c.receipt_hash=r.calculation_receipt_hash
          JOIN finance_policy_versions p ON p.environment=r.environment
            AND p.scope_id=r.scope_id AND p.strategy_account_id=r.strategy_account_id
            AND p.policy_version=r.policy_version
          JOIN observation_instrument_versions i ON
            i.instrument_version_id=p.policy_json->>'instrument_version_id'
          JOIN observation_account_snapshots s ON
            s.snapshot_hash=f.observation_snapshot_hash
          WHERE b.environment='live' AND b.scope_id='live'
            AND b.strategy_account_id=:account AND b.intent_id=:intent
            AND b.command_id=:client AND b.grant_id=:grant
            AND b.assignment_id=:assignment
            AND b.normalized_payload_hash=:payload
            AND a.client_id=:client AND a.normalized_payload_hash=:payload
            AND a.status='possible' AND r.status IN ('submitted','uncertain')
        """), {"account": scope.strategy_account_id, "intent": intent_id,
               "client": client_id, "grant": grant_id,
               "assignment": assignment_id,
               "payload": normalized_payload_hash})).mappings().first()
        if row is None:
            return None
        try:
            policy = SizingPolicy.model_validate(row["policy_json"])
            receipt = SizingReceipt.model_validate_json(json.dumps(row["receipt_json"]))
            instrument = InstrumentVersion.model_validate(row["instrument_manifest"])
            snapshot_row = {field: row[field] for field in (
                "snapshot_hash", "status", "origin", "observed_balances",
                "observed_positions", "balances_complete", "positions_complete",
                "event_at", "available_at", "received_at", "cutoff_at",
                "finality", "finality_at", "has_gap", "has_reorg", "rights_ref",
                "source_event_hash", "source_payload_hash", "registry_hash",
                "created_at", "coverage_scope", "source_block_number",
                "source_block_hash")}
            snapshot_row.update(environment=row["snapshot_environment"],
                scope_id=row["snapshot_scope_id"],
                strategy_account_id=row["snapshot_account_id"],
                source_account_id=row["snapshot_source_account_id"],
                policy_version=row["snapshot_policy_version"])
            snapshot = account_snapshot_from_row(snapshot_row)
            now = row["db_now"]
            if not isinstance(now, datetime):
                return None
            require_current_live_native_snapshot(snapshot, scope=scope,
                source_account_id=row["source_account_id"],
                policy_version=policy.policy_version, now=now,
                max_age_seconds=policy.max_observation_age_seconds)
            quote = await load_uniswap_quote(conn, row["quote_hash"])
            request = receipt.request
            authoritative = await resolve_sizing_request(conn, scope, {
                "observation_snapshot_hash": snapshot.snapshot_hash,
                "source_account_id": row["source_account_id"],
                "policy_version": policy.policy_version,
                "policy_hash": policy.policy_hash}, policy, request)
            valid = (
                account_snapshot_hash(snapshot) == snapshot.snapshot_hash
                and row["admission_state"] == "stopped"
                and row["reconciliation_state"] == "clean"
                and row["account_snapshot_hash"] == snapshot.snapshot_hash
                and row["hold_snapshot_hash"] == snapshot.snapshot_hash
                and row["hold_policy_version"] == policy.policy_version
                and row["hold_policy_hash"] == policy.policy_hash
                and row["account_policy_version"] == policy.policy_version
                and row["account_policy_hash"] == policy.policy_hash
                and row["stored_policy_hash"] == policy.policy_hash
                and row["approved_live"] is True and policy.approved_live
                and row["hold_authority_epoch"] == row["account_authority_epoch"]
                and row["authority_class"] == "live_native"
                and row["purpose"] == "trade"
                and row["controller_mode"] == "autopilot"
                and row["hold_controller_ref"] == row["controller_ref"]
                and row["hold_controller_ref"].get("controllerId") == assignment_id
                and row["hold_controller_ref"].get("controllerVersionId") == row["program_version_id"]
                and row["source_account_id"] == "arbitrum:42161:wallet:" + row["owner_address"]
                and row["expires_at"] > now
                and int(row["deadline"]) > int(now.timestamp())
                and receipt.receipt_hash == row["calculation_receipt_hash"]
                and receipt.account_revision == str(row["receipt_revision"])
                and receipt.policy_hash == policy.policy_hash
                and receipt.account_snapshot_hash == snapshot.snapshot_hash
                and size_intent(policy, request, row["receipt_revision"]) == receipt
                and authoritative == request
                and instrument.registry_hash == row["instrument_registry_hash"]
                and instrument.venue_id == "uniswap"
                and instrument.product_kind == "spot"
                and receipt.instrument_version_id == instrument.instrument_version_id
                and receipt.action == "spot_sell"
                and snapshot.coverage_scope == ARBITRUM_MANAGED_PAIR_COVERAGE
                and receipt.price_snapshot_hash == row["quote_hash"]
                and quote.amount_in == str(row["amount_in"])
                and quote.minimum_amount_out == str(row["amount_out_minimum"])
                and receipt.quantity_units == quote.amount_in
                and receipt.notional_units == quote.minimum_amount_out
            )
            if not valid:
                return None
        except (FinanceError, ValidationError, TypeError, KeyError, ValueError):
            return None
    return {"attemptId": row["attempt_id"], "reservationId": row["reservation_id"],
        "intentId": row["intent_id"], "clientId": row["command_id"],
        "normalizedPayloadHash": row["normalized_payload_hash"],
        "snapshotHash": snapshot.snapshot_hash,
        "strategyAccountId": scope.strategy_account_id,
        "sourceAccountId": snapshot.source_account_id,
        "policyVersion": policy.policy_version, "policyHash": policy.policy_hash,
        "authorityEpoch": row["hold_authority_epoch"],
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
        "action": receipt.action,
        "calculationReceiptHash": receipt.receipt_hash,
        "authorityFingerprint": row["authority_fingerprint"],
        "reservationControllerRef": row["hold_controller_ref"],
        "customerSubject": row["customer_subject"],
        "frozenProgramPolicyHash": row["frozen_program_policy_hash"]}
