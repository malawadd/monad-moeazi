"""Verified native Uniswap buy fold; the experiment journal ingress stays closed."""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
import re

from sqlalchemy import text

from .account_observation_storage import AccountObservationRepository
from .arbitrum_managed_pair_observation import build_arbitrum_managed_pair_snapshot
from .finance_contracts import (
    FinanceError, FinanceScope, JournalCommand, JournalPosting, ReconcileCommand,
    _digest, db_native_int, native_int, semantic_request_hash, source_event_digest,
)
from .finance_observation_contracts import ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID
from .finance_oracle import balanced_postings, projected_balances
from .finance_policy import SizingReceipt


_HEX32 = re.compile(r"^0x[0-9a-f]{64}$")


def _scope(scope: FinanceScope) -> dict:
    return scope.model_dump()


def _operation_proof(operation: dict, reservation: dict, quote,
                     snapshot) -> tuple[dict, str]:
    if operation.get("state") != "confirmed" or operation.get("scope") != "buy" \
            or operation.get("intentId") != reservation["intent_id"] \
            or operation.get("idempotencyKey") != reservation["client_id"]:
        raise FinanceError("confirmed Uniswap operation differs from financial attempt")
    for key in ("userOperationHash", "transactionHash", "confirmedBlockHash"):
        if not isinstance(operation.get(key), str) or not _HEX32.fullmatch(operation[key]):
            raise FinanceError("confirmed Uniswap identity is malformed")
    block = native_int(operation.get("confirmedBlockNumber"), positive=True)
    amount_in = native_int(operation.get("actualInputUnits"), positive=True)
    amount_out = native_int(operation.get("actualOutputUnits"), positive=True)
    if amount_in != native_int(quote.amount_in, positive=True) \
            or amount_out < native_int(quote.minimum_amount_out, positive=True) \
            or native_int(snapshot.source_block_number, positive=True) < block:
        raise FinanceError("confirmed swap or later account observation does not match")
    if int(snapshot.source_block_number) == block \
            and snapshot.source_block_hash != operation["confirmedBlockHash"]:
        raise FinanceError("account observation differs from confirmed transaction block")
    body = {"schemaVersion": 1, "scope": snapshot.scope.model_dump(),
        "reservationId": reservation["reservation_id"],
        "attemptId": reservation["attempt_id"], "intentId": reservation["intent_id"],
        "clientId": reservation["client_id"],
        "normalizedPayloadHash": reservation["normalized_payload_hash"],
        "grantId": operation["grantId"],
        "userOperationHash": operation["userOperationHash"],
        "transactionHash": operation["transactionHash"],
        "confirmedBlockNumber": str(block),
        "confirmedBlockHash": operation["confirmedBlockHash"],
        "actualInputUnits": str(amount_in), "actualOutputUnits": str(amount_out),
        "beforeSnapshotHash": reservation["snapshot_hash"],
        "afterSnapshotHash": snapshot.snapshot_hash}
    return body, _digest("moeazi-live-uniswap-fill-v1", body)


async def _existing_proof(finance, scope: FinanceScope, reservation_id: str) -> dict | None:
    async with finance.engine.connect() as conn:
        row = (await conn.execute(text("""
          SELECT * FROM finance_live_uniswap_fills WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account AND reservation_id=:reservation
        """), {"account": scope.strategy_account_id,
               "reservation": reservation_id})).mappings().first()
    return dict(row) if row else None


async def _post_fill_observation(finance, scope, native, policy_version, operation,
                                 sidecar):
    raw = await sidecar("account", {"owner": native["ownerAddress"]})
    snapshot = build_arbitrum_managed_pair_snapshot(raw, scope=scope,
        expected_account=native["ownerAddress"], policy_version=policy_version,
        received_at=datetime.now(timezone.utc))
    if native_int(snapshot.source_block_number, positive=True) < native_int(
            operation["confirmedBlockNumber"], positive=True):
        raise FinanceError("post-fill account observation predates confirmed block")
    if snapshot.source_block_number == operation["confirmedBlockNumber"] \
            and snapshot.source_block_hash != operation["confirmedBlockHash"]:
        raise FinanceError("post-fill account block differs from confirmed block")
    await AccountObservationRepository(finance.engine).store_native_snapshot(snapshot)
    return snapshot


async def _fold_native_buy(finance, scope, reservation, operation, quote, snapshot,
                           proof: dict, proof_hash: str, writer_epoch: int) -> dict:
    amount_in = native_int(proof["actualInputUnits"], positive=True)
    amount_out = native_int(proof["actualOutputUnits"], positive=True)
    location = snapshot.source_account_id
    registrations = {(row.asset_unit_id, row.location_id, row.book): row.registry_hash
                     for row in snapshot.observed_balances}
    usdc_registry = registrations.get((ARBITRUM_USDC_UNIT_ID, location, "wallet"))
    weth_registry = registrations.get((ARBITRUM_WETH_UNIT_ID, location, "wallet"))
    if not usdc_registry or not weth_registry:
        raise FinanceError("post-fill pair asset registrations are unavailable")
    postings = (
        JournalPosting(asset_unit_id=ARBITRUM_USDC_UNIT_ID, registry_hash=usdc_registry,
            location_id=location, book="wallet", units=str(-amount_in)),
        JournalPosting(asset_unit_id=ARBITRUM_USDC_UNIT_ID, registry_hash=usdc_registry,
            location_id=location, book="external", units=str(amount_in)),
        JournalPosting(asset_unit_id=ARBITRUM_WETH_UNIT_ID, registry_hash=weth_registry,
            location_id=location, book="wallet", units=str(amount_out)),
        JournalPosting(asset_unit_id=ARBITRUM_WETH_UNIT_ID, registry_hash=weth_registry,
            location_id=location, book="external", units=str(-amount_out)),
    )
    balanced_postings(postings)
    event_at = snapshot.event_at
    provisional = JournalCommand.model_construct(scope=scope, expected_revision=0,
        writer_epoch=writer_epoch, idempotency_key="native-uniswap-fill:" + proof_hash,
        request_hash="0" * 64, source_owner=location,
        source_stream=("arbitrum:42161:managed-vault-finalized"
                       if proof.get("vaultAddress") else "arbitrum:42161:uniswap-v3-finalized"),
        source_event_id=proof["transactionHash"],
        source_revision=proof["confirmedBlockHash"], source_event_hash="0" * 64,
        source_payload_hash=proof_hash, kind="fill", observed_at=event_at,
        postings=postings, reverses_transaction_id=None)
    source_hash = source_event_digest(provisional)
    provisional = provisional.model_copy(update={"source_event_hash": source_hash})
    transaction_id = sha256(("journal:live:live:" + scope.strategy_account_id
                             + ":" + source_hash).encode()).hexdigest()
    async with finance.engine.begin() as conn:
        account = await finance._lock(conn, scope)
        await finance._writer(conn, account, writer_epoch)
        old = (await conn.execute(text("""
          SELECT * FROM finance_live_uniswap_fills WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account AND reservation_id=:reservation
        """), {"account": scope.strategy_account_id,
               "reservation": reservation["reservation_id"]})).mappings().first()
        if old:
            if old["proof_hash"] != proof_hash or old["journal_transaction_id"] != transaction_id:
                raise FinanceError("native fill proof conflicts with prior settlement")
            return {"transactionId": transaction_id, "revision": int(account["revision"]),
                    "snapshotHash": snapshot.snapshot_hash}
        hold = await finance._reservation(conn, scope, reservation["reservation_id"])
        attempt = (await conn.execute(text("""
          SELECT * FROM finance_submission_attempts WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account AND attempt_id=:attempt FOR UPDATE
        """), {"account": scope.strategy_account_id,
               "attempt": reservation["attempt_id"]})).mappings().first()
        if hold["status"] not in {"submitted", "uncertain"} or not attempt \
                or attempt["status"] not in {"possible", "dispatching"} \
                or attempt["reservation_id"] != hold["reservation_id"] \
                or attempt["client_id"] != reservation["client_id"] \
                or attempt["normalized_payload_hash"] != reservation["normalized_payload_hash"] \
                or hold["intent_id"] != reservation["intent_id"] \
                or hold["snapshot_hash"] != reservation["snapshot_hash"]:
            raise FinanceError("retained native attempt or reservation identity changed")
        if account["source_account_id"] != location \
                or account["observation_snapshot_hash"] != hold["snapshot_hash"] \
                or account["policy_hash"] != hold["policy_hash"]:
            raise FinanceError("native account changed before confirmed fill fold")
        current = await finance._current_balances(conn, scope)
        projected = projected_balances(current, postings)
        for asset, actual in ((ARBITRUM_USDC_UNIT_ID, amount_in),
                              (ARBITRUM_WETH_UNIT_ID, amount_out)):
            before = current.get((asset, location, "wallet"), 0)
            after = projected.get((asset, location, "wallet"), 0)
            observed = next((native_int(row.units, nonnegative=True)
                for row in snapshot.observed_balances if row.asset_unit_id == asset
                and row.location_id == location and row.book == "wallet"), None)
            if observed is None or after != observed:
                raise FinanceError("post-fill account and projected journal balances differ")
            if asset == ARBITRUM_USDC_UNIT_ID and before - after != actual \
                    or asset == ARBITRUM_WETH_UNIT_ID and after - before != actual:
                raise FinanceError("confirmed swap delta differs from account observation")
        revision = int(account["revision"]) + 1
        command = JournalCommand.model_construct(**{**provisional.model_dump(mode="python"),
            "expected_revision": int(account["revision"]),
            "request_hash": "0" * 64})
        command = JournalCommand.model_validate({**command.model_dump(mode="python"),
            "request_hash": semantic_request_hash("journal", command)})
        await conn.execute(text("""
          INSERT INTO finance_source_events(environment,scope_id,strategy_account_id,
            source_event_hash,source_owner,source_stream,source_event_id,source_revision,
            source_payload_hash,event_kind,observed_at)
          VALUES('live','live',:account,:hash,:owner,:stream,:event,:source_revision,
            :payload,'fill',:observed)
        """), {"account": scope.strategy_account_id, "hash": source_hash,
               "owner": location, "stream": command.source_stream,
               "event": command.source_event_id, "source_revision": command.source_revision,
               "payload": proof_hash, "observed": event_at})
        await conn.execute(text("""
          INSERT INTO finance_journal_transactions(environment,scope_id,strategy_account_id,
            transaction_id,source_event_hash,posting_count,request_hash,account_revision)
          VALUES('live','live',:account,:transaction,:source,4,:request,:revision)
        """), {"account": scope.strategy_account_id, "transaction": transaction_id,
               "source": source_hash, "request": command.request_hash, "revision": revision})
        for ordinal, posting in enumerate(postings, 1):
            await conn.execute(text("""
              INSERT INTO finance_journal_postings(environment,scope_id,strategy_account_id,
                transaction_id,ordinal,asset_unit_id,registry_hash,location_id,book,units)
              VALUES('live','live',:account,:transaction,:ordinal,:asset,:registry,
                :location,:book,:units)
            """), {"account": scope.strategy_account_id, "transaction": transaction_id,
                   "ordinal": ordinal, "asset": posting.asset_unit_id,
                   "registry": posting.registry_hash, "location": posting.location_id,
                   "book": posting.book, "units": posting.units})
            await finance._balance_delta(conn, scope, posting.asset_unit_id,
                posting.registry_hash, posting.location_id, posting.book,
                posting.units, revision)
        await conn.execute(text("""
          UPDATE finance_submission_attempts SET status='confirmed',native_id=:transaction
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
            AND attempt_id=:attempt AND status IN ('possible','dispatching')
        """), {"account": scope.strategy_account_id, "attempt": attempt["attempt_id"],
               "transaction": operation["transactionHash"]})
        await conn.execute(text("""
          UPDATE finance_reservations SET status='settled',resolution_proof_hash=:proof,
            retention_reason=NULL,updated_at=clock_timestamp()
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
            AND reservation_id=:reservation AND status IN ('submitted','uncertain')
        """), {"account": scope.strategy_account_id, "reservation": hold["reservation_id"],
               "proof": proof_hash})
        await conn.execute(text("""
          INSERT INTO finance_live_uniswap_fills(environment,scope_id,strategy_account_id,
            proof_hash,reservation_id,attempt_id,intent_id,client_id,normalized_payload_hash,
            grant_id,user_operation_hash,vault_address,order_id,
            transaction_hash,confirmed_block_number,
            confirmed_block_hash,actual_input_units,actual_output_units,before_snapshot_hash,
            after_snapshot_hash,journal_transaction_id,proof_json)
          VALUES('live','live',:account,:proof,:reservation,:attempt,:intent,:client,:payload,
            :grant,:user_op,:vault,:order_id,:transaction,:block,:block_hash,:input,:output,:before,:after,
            :journal,CAST(:body AS jsonb))
        """), {"account": scope.strategy_account_id, "proof": proof_hash,
               "reservation": hold["reservation_id"], "attempt": attempt["attempt_id"],
               "intent": hold["intent_id"], "client": attempt["client_id"],
               "payload": attempt["normalized_payload_hash"], "grant": proof["grantId"],
               "user_op": proof.get("userOperationHash"),
               "vault": proof.get("vaultAddress"), "order_id": proof.get("orderId"),
               "transaction": proof["transactionHash"],
               "block": proof["confirmedBlockNumber"],
               "block_hash": proof["confirmedBlockHash"],
               "input": proof["actualInputUnits"], "output": proof["actualOutputUnits"],
               "before": hold["snapshot_hash"], "after": snapshot.snapshot_hash,
               "journal": transaction_id,
               "body": json.dumps(proof, sort_keys=True, separators=(",", ":"))})
        updated = await finance._advance(conn, scope, writer_epoch, account,
            reconciliation_state="unknown",
            reconciliation_reason="journal_ahead_of_observation")
        await finance._outbox(conn, scope, updated)
        return {"transactionId": transaction_id, "revision": updated["revision"],
                "snapshotHash": snapshot.snapshot_hash}


async def settle_confirmed_buy(finance, *, scope: FinanceScope, native: dict,
        proposal_id: str, context: dict, reservation: dict, quote, operation: dict,
        writer_epoch: int, sidecar) -> dict:
    """Settle only a final native source followed by an independent pair account read."""
    _ = (proposal_id, context, writer_epoch)
    prior = await _existing_proof(finance, scope, reservation["reservation_id"])
    if prior:
        if prior["transaction_hash"] != operation.get("transactionHash") \
                or prior["attempt_id"] != reservation["attempt_id"]:
            raise FinanceError("confirmed operation conflicts with native fill proof")
        snapshot_hash = prior["after_snapshot_hash"]
        transaction_id = prior["journal_transaction_id"]
    else:
        snapshot = await _post_fill_observation(finance, scope, native,
            reservation["policy_version"], operation, sidecar)
        proof, proof_hash = _operation_proof(operation, reservation, quote, snapshot)
        epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
        folded = await _fold_native_buy(finance, scope, reservation, operation, quote,
                                        snapshot, proof, proof_hash, epoch)
        snapshot_hash, transaction_id = folded["snapshotHash"], folded["transactionId"]
    state = await finance.read_account_risk_snapshot(scope)
    if state["reconciliationState"] == "clean" \
            and state["observationSnapshotHash"] == snapshot_hash:
        return {"snapshotHash": snapshot_hash, "transactionId": transaction_id,
                "revision": state["accountRevision"]}
    epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
    account_revision = native_int(state["accountRevision"], nonnegative=True)
    provisional = ReconcileCommand.model_construct(scope=scope,
        expected_revision=account_revision, writer_epoch=epoch,
        idempotency_key="native-uniswap-fill-reconcile:" + transaction_id,
        request_hash="0" * 64, snapshot_hash=snapshot_hash,
        policy_version=reservation["policy_version"], policy_hash=reservation["policy_hash"])
    command = ReconcileCommand.model_validate({**provisional.model_dump(mode="python"),
        "request_hash": semantic_request_hash("reconcile", provisional)})
    result = await finance.reconcile_account(command)
    if result["status"] != "clean":
        raise FinanceError("native post-fill account did not reconcile cleanly")
    return {"snapshotHash": snapshot_hash, "transactionId": transaction_id,
            "revision": str(result["revision"])}
