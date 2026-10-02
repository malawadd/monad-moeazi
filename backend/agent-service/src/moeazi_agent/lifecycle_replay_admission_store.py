"""Atomic experiment-only replay receipt, multi-asset hold, and intent insert."""
from __future__ import annotations

import json
from hashlib import sha256

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest
from .lifecycle_contracts import TradeIntent
from .lifecycle_entry_progress import store_entry_progress
from .lifecycle_replay_finance_contracts import ReplaySizingReceipt
from .lifecycle_replay_intent import replay_intent_id
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params


def _key(scope: FinanceScope, run_id: str, request_id: str) -> str:
    return sha256(("moeazi-replay-reservation-v1:" + scope.environment + ":" +
        scope.scope_id + ":" + scope.strategy_account_id + ":" + run_id + ":" +
        request_id).encode("utf-8")).hexdigest()


async def store_replay_admission(repository, conn, scope: FinanceScope,
                                 manifest: SimulationRunManifest, run: dict,
                                 account: dict, request: dict,
                                 receipt: ReplaySizingReceipt, intent: TradeIntent,
                                 writer_epoch: int, authority_fingerprint: str,
                                 expires_at) -> dict:
    """Caller owns the account/run locks, fresh authority check, and capacity proof."""
    params = _run_params(scope, run["run_id"])
    if scope.environment != "experiment" or receipt.scope != scope or \
            intent.scope != scope or receipt.run_id != run["run_id"] or \
            receipt.manifest_hash != manifest.manifest_hash or \
            intent.run_manifest_hash != manifest.manifest_hash or \
            receipt.request_id != request["request_id"] or \
            request["manifest_hash"] != run["manifest_hash"] or \
            request["status"] in {"rejected", "completed", "submission_possible"} or \
            receipt.account_revision != str(account["revision"]) or \
            receipt.account_snapshot_hash != account["observation_snapshot_hash"] or \
            intent.calculation_receipt_hash != receipt.receipt_hash or \
            intent.intent_id != replay_intent_id(
                manifest, request["request_id"]):
        raise FinanceError("replay admission has contradictory economic identity")
    reservation_id = _key(scope, run["run_id"], request["request_id"])
    command_hash = _digest("moeazi-replay-reservation-request-v1", {
        "scope": scope.model_dump(mode="json"), "runId": run["run_id"],
        "requestHash": request["request_hash"], "receiptHash": receipt.receipt_hash,
        "intentHash": intent.intent_hash, "expiresAt": expires_at.isoformat()})
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
    next_revision = account["revision"] + 1
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
           "request_hash": command_hash, "intent": intent.intent_id,
           "controller": json.dumps(intent.controller_ref.model_dump(),
                                    sort_keys=True, separators=(",", ":")),
           "mode": intent.controller_mode, "snapshot": receipt.account_snapshot_hash,
           "policy": receipt.policy_version, "policy_hash": receipt.policy_hash,
           "writer_epoch": writer_epoch, "authority_epoch": account["authority_epoch"],
           "fingerprint": authority_fingerprint, "receipt": receipt.receipt_hash,
           "revision": next_revision, "expires_at": expires_at})
    for ordinal, part in enumerate(receipt.components, 1):
        await conn.execute(text("""
            INSERT INTO finance_reservation_components(environment,scope_id,
              strategy_account_id,reservation_id,ordinal,capacity_key,
              asset_unit_id,registry_hash,location_id,units)
            VALUES(:environment,:scope_id,:strategy_account_id,:id,:ordinal,
              :capacity_key,:asset,:registry,:location,:units)
        """), {**params, "id": reservation_id, "ordinal": ordinal,
               "capacity_key": part.capacity_key, "asset": part.asset_unit_id,
               "registry": part.registry_hash, "location": part.location_id,
               "units": part.units})
    await conn.execute(text("""
        INSERT INTO simulation_intents(environment,scope_id,strategy_account_id,
          run_id,intent_id,intent_hash,intent_json)
        VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:id,:hash,
          CAST(:body AS jsonb))
    """), {**params, "id": intent.intent_id, "hash": intent.intent_hash,
           "body": intent.model_dump_json()})
    updated = await repository.finance._advance(conn, scope, writer_epoch, account)
    await repository.finance._insert_claim(conn, scope, "replay_reserve",
        reservation_id, command_hash, reservation_id, updated["revision"])
    progress = {"requestHash": request["request_hash"],
                "intentId": intent.intent_id, "intentHash": intent.intent_hash,
                "reservationId": reservation_id,
                "calculationReceiptHash": receipt.receipt_hash,
                "accountRevision": updated["revision"],
                "orderOrdinal": receipt.order_ordinal}
    await store_entry_progress(conn, scope, run["run_id"], run["manifest_hash"],
        request["request_id"], "admission", progress)
    await conn.execute(text("""
        UPDATE simulation_entry_requests SET intent_id=:intent_id,
          status='awaiting_finance',reason='reservation_committed',
          updated_at=clock_timestamp()
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND request_id=:request_id
    """), {**params, "request_id": request["request_id"],
           "intent_id": intent.intent_id})
    await conn.execute(text("""
        UPDATE simulation_runs SET projection_revision=projection_revision+1,
          updated_at=clock_timestamp()
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
    """), params)
    await repository.finance._outbox(conn, scope, updated)
    return progress
