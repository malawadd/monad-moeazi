"""Financially atomic experimental close hold and immutable mandate."""
from __future__ import annotations

from datetime import timedelta
import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest
from .lifecycle_contracts import TradeIntent
from .lifecycle_maintenance_store import store_maintenance_mandate
from .lifecycle_replay_admission_store import _key
from .lifecycle_replay_finance_contracts import ReplaySizingReceipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params


async def reserve_maintenance_close(repository, conn, scope: FinanceScope,
                                    manifest: SimulationRunManifest, run: dict,
                                    account: dict, command: dict,
                                    receipt: ReplaySizingReceipt,
                                    intent: TradeIntent, policy,
                                    writer_epoch: int, now):
    """Caller holds account/run locks; no approval or entry callback is inferred."""
    params = _run_params(scope, manifest.run_id)
    request_id = "maintenance:" + command["command_hash"]
    reservation_id = _key(scope, manifest.run_id, request_id)
    if scope.environment != "experiment" or \
            account["reconciliation_state"] != "clean" or \
            account["admission_state"] not in {"open", "stopped"} or \
            receipt.code_version != "replay-sizing-v2" or \
            receipt.request_id != request_id or \
            receipt.account_revision != str(account["revision"]) or \
            receipt.account_snapshot_hash != account["observation_snapshot_hash"] or \
            receipt.manifest_hash != manifest.manifest_hash or \
            intent.maintenance_command_hash != command["command_hash"] or \
            intent.calculation_receipt_hash != receipt.receipt_hash or \
            intent.run_manifest_hash != manifest.manifest_hash or \
            policy.policy_hash != manifest.policy_hash:
        raise FinanceError("maintenance hold differs from current stopped-safe authority")
    digest = _digest("moeazi-maintenance-reservation-v1", {
        "scope": scope.model_dump(mode="json"), "runId": manifest.run_id,
        "commandHash": command["command_hash"],
        "receiptHash": receipt.receipt_hash, "intentHash": intent.intent_hash})
    if await repository.finance._claim(conn, scope, "maintenance_reserve",
                                       reservation_id, digest) is not None:
        raise FinanceError("maintenance hold exists without its immutable mandate")
    await repository.finance._capacity_check(conn, scope, receipt.components)
    await conn.execute(text("""
        INSERT INTO finance_calculation_receipts(environment,scope_id,
          strategy_account_id,receipt_hash,account_revision,
          observation_snapshot_hash,policy_version,policy_hash,receipt_json,
          authority_class)
        VALUES(:environment,:scope_id,:strategy_account_id,:hash,:revision,
          :snapshot,:policy,:policy_hash,CAST(:body AS jsonb),'experiment_only')
    """), {**params, "hash": receipt.receipt_hash, "revision": account["revision"],
           "snapshot": receipt.account_snapshot_hash,
           "policy": receipt.policy_version, "policy_hash": receipt.policy_hash,
           "body": receipt.model_dump_json()})
    authority_fingerprint = _digest("moeazi-maintenance-authority-v1", {
        "scope": scope.model_dump(mode="json"), "runId": manifest.run_id,
        "manifestHash": manifest.manifest_hash,
        "commandHash": command["command_hash"],
        "authorityEpoch": account["authority_epoch"]})
    await conn.execute(text("""
        INSERT INTO finance_reservations(environment,scope_id,strategy_account_id,
          reservation_id,idempotency_key,request_hash,intent_id,purpose,
          controller_ref,controller_mode,snapshot_hash,policy_version,policy_hash,
          writer_epoch,authority_epoch,authority_fingerprint,
          calculation_receipt_hash,admitted_revision,status,expires_at)
        VALUES(:environment,:scope_id,:strategy_account_id,:id,:idempotency,
          :request_hash,:intent,'trade',CAST(:controller AS jsonb),:mode,
          :snapshot,:policy,:policy_hash,:writer_epoch,:authority_epoch,
          :fingerprint,:receipt,:revision,'reserved',:expires_at)
    """), {**params, "id": reservation_id, "idempotency": reservation_id,
           "request_hash": digest, "intent": intent.intent_id,
           "controller": json.dumps(manifest.controller_ref.model_dump(),
                                    sort_keys=True, separators=(",", ":")),
           "mode": manifest.controller_mode,
           "snapshot": receipt.account_snapshot_hash,
           "policy": receipt.policy_version, "policy_hash": receipt.policy_hash,
           "writer_epoch": writer_epoch,
           "authority_epoch": account["authority_epoch"],
           "fingerprint": authority_fingerprint,
           "receipt": receipt.receipt_hash,
           "revision": account["revision"] + 1,
           "expires_at": now + timedelta(seconds=policy.max_reservation_seconds)})
    for ordinal, part in enumerate(receipt.components, 1):
        await conn.execute(text("""
            INSERT INTO finance_reservation_components(environment,scope_id,
              strategy_account_id,reservation_id,ordinal,capacity_key,
              asset_unit_id,registry_hash,location_id,units)
            VALUES(:environment,:scope_id,:strategy_account_id,:id,:ordinal,
              :capacity_key,:asset,:registry,:location,:units)
        """), {**params, "id": reservation_id, "ordinal": ordinal,
               "capacity_key": part.capacity_key,
               "asset": part.asset_unit_id, "registry": part.registry_hash,
               "location": part.location_id, "units": part.units})
    await conn.execute(text("""
        INSERT INTO simulation_intents(environment,scope_id,strategy_account_id,
          run_id,intent_id,intent_hash,intent_json)
        VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:id,:hash,
          CAST(:body AS jsonb))
    """), {**params, "id": intent.intent_id,
           "hash": intent.intent_hash, "body": intent.model_dump_json()})
    updated = await repository.finance._advance(conn, scope, writer_epoch, account)
    await repository.finance._insert_claim(conn, scope, "maintenance_reserve",
        reservation_id, digest, reservation_id, updated["revision"])
    mandate = await store_maintenance_mandate(conn, scope, manifest.run_id,
        manifest.manifest_hash, command["command_id"], receipt, intent,
        reservation_id)
    await conn.execute(text("""
        UPDATE simulation_runs SET projection_revision=projection_revision+1,
          updated_at=clock_timestamp()
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
    """), params)
    await repository.finance._outbox(conn, scope, updated)
    return mandate
