"""Finalized WETH exit fold and independently observed flat account proof."""
from __future__ import annotations

from hashlib import sha256
import json
import re

from sqlalchemy import text

from .finance_contracts import (
    FinanceError, FinanceScope, JournalCommand, JournalPosting, ReconcileCommand,
    _digest, db_native_int, native_int, semantic_request_hash, source_event_digest,
)
from .finance_observation_contracts import ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID
from .finance_oracle import balanced_postings, projected_balances
from .managed_uniswap_buy_settlement import _post_fill_observation


_HEX32 = re.compile(r"^0x[0-9a-f]{64}$")


def _proof(operation: dict, reservation: dict, quote, snapshot) -> tuple[dict, str]:
    if (operation.get("state") != "confirmed" or operation.get("scope") != "exit"
            or operation.get("intentId") != reservation["intent_id"]
            or operation.get("idempotencyKey") != reservation["client_id"]):
        raise FinanceError("confirmed exit differs from retained financial attempt")
    if any(not isinstance(operation.get(key), str)
           or not _HEX32.fullmatch(operation[key])
           for key in ("userOperationHash", "transactionHash", "confirmedBlockHash")):
        raise FinanceError("finalized exit identity is malformed")
    block = native_int(operation.get("confirmedBlockNumber"), positive=True)
    amount_in = native_int(operation.get("actualInputUnits"), positive=True)
    amount_out = native_int(operation.get("actualOutputUnits"), positive=True)
    if (amount_in != native_int(quote.amount_in, positive=True)
            or amount_out < native_int(quote.minimum_amount_out, positive=True)
            or native_int(snapshot.source_block_number, positive=True) < block
            or (native_int(snapshot.source_block_number) == block
                and snapshot.source_block_hash != operation["confirmedBlockHash"])):
        raise FinanceError("exit fill or later account block differs from scoped quote")
    body = {"schemaVersion": 1, "scope": snapshot.scope.model_dump(),
        "reservationId": reservation["reservation_id"],
        "attemptId": reservation["attempt_id"],
        "intentId": reservation["intent_id"], "clientId": reservation["client_id"],
        "normalizedPayloadHash": reservation["normalized_payload_hash"],
        "grantId": operation["grantId"],
        "userOperationHash": operation["userOperationHash"],
        "transactionHash": operation["transactionHash"],
        "confirmedBlockNumber": str(block),
        "confirmedBlockHash": operation["confirmedBlockHash"],
        "actualInputUnits": str(amount_in), "actualOutputUnits": str(amount_out),
        "beforeSnapshotHash": reservation["snapshot_hash"],
        "afterSnapshotHash": snapshot.snapshot_hash}
    return body, _digest("moeazi-live-uniswap-exit-v1", body)


async def _prior(finance, scope: FinanceScope, reservation_id: str) -> dict | None:
    async with finance.engine.connect() as conn:
        row = (await conn.execute(text("""
          SELECT * FROM finance_live_uniswap_exit_fills
          WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account AND reservation_id=:reservation
        """), {"account": scope.strategy_account_id,
               "reservation": reservation_id})).mappings().first()
    return dict(row) if row else None


async def _fold_exit(finance, scope, reservation, operation, snapshot, proof,
                     proof_hash, writer_epoch):
    location = snapshot.source_account_id
    registration = {(item.asset_unit_id, item.location_id, item.book): item.registry_hash
                    for item in snapshot.observed_balances}
    usdc_registry = registration.get((ARBITRUM_USDC_UNIT_ID, location, "wallet"))
    weth_registry = registration.get((ARBITRUM_WETH_UNIT_ID, location, "wallet"))
    if not usdc_registry or not weth_registry:
        raise FinanceError("post-exit pair registrations are incomplete")
    weth_input = native_int(proof["actualInputUnits"], positive=True)
    usdc_output = native_int(proof["actualOutputUnits"], positive=True)
    postings = (
        JournalPosting(asset_unit_id=ARBITRUM_WETH_UNIT_ID, registry_hash=weth_registry,
            location_id=location, book="wallet", units=str(-weth_input)),
        JournalPosting(asset_unit_id=ARBITRUM_WETH_UNIT_ID, registry_hash=weth_registry,
            location_id=location, book="external", units=str(weth_input)),
        JournalPosting(asset_unit_id=ARBITRUM_USDC_UNIT_ID, registry_hash=usdc_registry,
            location_id=location, book="wallet", units=str(usdc_output)),
        JournalPosting(asset_unit_id=ARBITRUM_USDC_UNIT_ID, registry_hash=usdc_registry,
            location_id=location, book="external", units=str(-usdc_output)),
    )
    balanced_postings(postings)
    provisional = JournalCommand.model_construct(scope=scope, expected_revision=0,
        writer_epoch=writer_epoch, idempotency_key="native-uniswap-exit:" + proof_hash,
        request_hash="0" * 64, source_owner=location,
        source_stream=("arbitrum:42161:managed-vault-finalized-exit"
                       if proof.get("vaultAddress") else "arbitrum:42161:uniswap-v3-finalized-exit"),
        source_event_id=proof["transactionHash"],
        source_revision=proof["confirmedBlockHash"], source_event_hash="0" * 64,
        source_payload_hash=proof_hash, kind="fill", observed_at=snapshot.event_at,
        postings=postings, reverses_transaction_id=None)
    source_hash = source_event_digest(provisional)
    transaction_id = sha256(("journal:live:live:" + scope.strategy_account_id
                             + ":" + source_hash).encode()).hexdigest()
    async with finance.engine.begin() as conn:
        account = await finance._lock(conn, scope)
        await finance._writer(conn, account, writer_epoch)
        prior = (await conn.execute(text("""
          SELECT proof_hash,journal_transaction_id FROM finance_live_uniswap_exit_fills
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
            AND reservation_id=:reservation
        """), {"account": scope.strategy_account_id,
               "reservation": reservation["reservation_id"]})).mappings().first()
        if prior:
            if prior["proof_hash"] != proof_hash or prior["journal_transaction_id"] != transaction_id:
                raise FinanceError("exit proof conflicts with prior settlement")
            return transaction_id
        hold = await finance._reservation(conn, scope, reservation["reservation_id"])
        attempt = (await conn.execute(text("""
          SELECT * FROM finance_submission_attempts
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
            AND attempt_id=:attempt FOR UPDATE
        """), {"account": scope.strategy_account_id,
               "attempt": reservation["attempt_id"]})).mappings().first()
        binding = (await conn.execute(text("""
          SELECT * FROM finance_live_uniswap_exit_bindings
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
            AND attempt_id=:attempt
        """), {"account": scope.strategy_account_id,
               "attempt": reservation["attempt_id"]})).mappings().first()
        if (hold["status"] not in {"submitted", "uncertain"}
                or not attempt or attempt["status"] not in {"possible", "dispatching"}
                or not binding or binding["reservation_id"] != hold["reservation_id"]
                or binding["grant_id"] != proof["grantId"]
                or (proof.get("vaultAddress") and (
                    binding["vault_address"] != proof["vaultAddress"]
                    or binding["order_id"] != proof["orderId"]))
                or attempt["reservation_id"] != hold["reservation_id"]
                or attempt["client_id"] != proof["clientId"]
                or attempt["normalized_payload_hash"] != proof["normalizedPayloadHash"]
                or hold["intent_id"] != proof["intentId"]
                or hold["snapshot_hash"] != proof["beforeSnapshotHash"]
                or account["source_account_id"] != location
                or account["observation_snapshot_hash"] != hold["snapshot_hash"]
                or account["admission_state"] != "stopped"):
            raise FinanceError("stopped exit attempt or before snapshot changed")
        current = await finance._current_balances(conn, scope)
        projected = projected_balances(current, postings)
        observed = {(item.asset_unit_id, item.location_id, item.book):
                    native_int(item.units, nonnegative=True)
                    for item in snapshot.observed_balances}
        usdc_key = (ARBITRUM_USDC_UNIT_ID, location, "wallet")
        weth_key = (ARBITRUM_WETH_UNIT_ID, location, "wallet")
        if (current.get(weth_key, 0) != weth_input
                or projected.get(weth_key, 0) != 0
                or observed.get(weth_key) != 0
                or projected.get(usdc_key, 0) != observed.get(usdc_key)
                or projected.get(usdc_key, 0) - current.get(usdc_key, 0) != usdc_output):
            raise FinanceError("finalized exit does not independently prove flat WETH")
        revision = int(account["revision"]) + 1
        command = JournalCommand.model_construct(**{**provisional.model_dump(mode="python"),
            "expected_revision": int(account["revision"]), "request_hash": "0" * 64})
        command = JournalCommand.model_validate({**command.model_dump(mode="python"),
            "request_hash": semantic_request_hash("journal", command)})
        await conn.execute(text("""
          INSERT INTO finance_source_events(environment,scope_id,strategy_account_id,
            source_event_hash,source_owner,source_stream,source_event_id,source_revision,
            source_payload_hash,event_kind,observed_at)
          VALUES('live','live',:account,:source,:owner,:stream,:event,:source_revision,
            :payload,'fill',:observed)
        """), {"account": scope.strategy_account_id, "source": source_hash,
               "owner": location, "stream": command.source_stream,
               "event": command.source_event_id,
               "source_revision": command.source_revision,
               "payload": proof_hash, "observed": snapshot.event_at})
        await conn.execute(text("""
          INSERT INTO finance_journal_transactions(environment,scope_id,strategy_account_id,
            transaction_id,source_event_hash,posting_count,request_hash,account_revision)
          VALUES('live','live',:account,:transaction,:source,4,:request,:revision)
        """), {"account": scope.strategy_account_id, "transaction": transaction_id,
               "source": source_hash, "request": command.request_hash,
               "revision": revision})
        for ordinal, posting in enumerate(postings, 1):
            await conn.execute(text("""
              INSERT INTO finance_journal_postings(environment,scope_id,strategy_account_id,
                transaction_id,ordinal,asset_unit_id,registry_hash,location_id,book,units)
              VALUES('live','live',:account,:transaction,:ordinal,:asset,:registry,
                :location,:book,:units)
            """), {"account": scope.strategy_account_id,
                   "transaction": transaction_id, "ordinal": ordinal,
                   "asset": posting.asset_unit_id, "registry": posting.registry_hash,
                   "location": posting.location_id, "book": posting.book,
                   "units": posting.units})
            await finance._balance_delta(conn, scope, posting.asset_unit_id,
                posting.registry_hash, posting.location_id, posting.book,
                posting.units, revision)
        await conn.execute(text("""
          UPDATE finance_submission_attempts SET status='confirmed',native_id=:transaction
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
            AND attempt_id=:attempt AND status IN ('possible','dispatching')
        """), {"account": scope.strategy_account_id, "attempt": attempt["attempt_id"],
               "transaction": proof["transactionHash"]})
        await conn.execute(text("""
          UPDATE finance_reservations SET status='settled',resolution_proof_hash=:proof,
            retention_reason=NULL,updated_at=clock_timestamp()
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
            AND reservation_id=:reservation AND status IN ('submitted','uncertain')
        """), {"account": scope.strategy_account_id,
               "reservation": hold["reservation_id"], "proof": proof_hash})
        await conn.execute(text("""
          INSERT INTO finance_live_uniswap_exit_fills(environment,scope_id,strategy_account_id,
            proof_hash,reservation_id,attempt_id,grant_id,user_operation_hash,
            vault_address,order_id,
            transaction_hash,confirmed_block_number,confirmed_block_hash,
            actual_input_units,actual_output_units,before_snapshot_hash,
            after_snapshot_hash,journal_transaction_id,proof_json)
          VALUES('live','live',:account,:proof,:reservation,:attempt,:grant,:user_op,
            :vault,:order_id,:transaction,:block,:block_hash,:input,:output,:before,:after,:journal,
            CAST(:body AS jsonb))
        """), {"account": scope.strategy_account_id, "proof": proof_hash,
               "reservation": hold["reservation_id"], "attempt": attempt["attempt_id"],
               "grant": proof["grantId"], "user_op": proof.get("userOperationHash"),
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
        return transaction_id


async def settle_confirmed_exit(finance, *, scope: FinanceScope, reservation: dict,
        quote, operation: dict, native: dict, sidecar) -> dict:
    """No flat status until finalized fill, balanced journal and current account agree."""
    prior = await _prior(finance, scope, reservation["reservation_id"])
    if prior:
        if prior["attempt_id"] != reservation["attempt_id"] \
                or prior["transaction_hash"] != operation.get("transactionHash"):
            raise FinanceError("exit operation differs from immutable prior proof")
        snapshot_hash = prior["after_snapshot_hash"]
        transaction_id = prior["journal_transaction_id"]
    else:
        snapshot = await _post_fill_observation(finance, scope, native,
            reservation["policy_version"], operation, sidecar)
        proof, digest = _proof(operation, reservation, quote, snapshot)
        epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
        transaction_id = await _fold_exit(finance, scope, reservation,
                                           operation, snapshot, proof, digest, epoch)
        snapshot_hash = snapshot.snapshot_hash
    view = await finance.read_account_risk_snapshot(scope)
    if view["reconciliationState"] != "clean" \
            or view["observationSnapshotHash"] != snapshot_hash:
        epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
        provisional = ReconcileCommand.model_construct(scope=scope,
            expected_revision=native_int(view["accountRevision"], nonnegative=True),
            writer_epoch=epoch,
            idempotency_key="native-uniswap-exit-reconcile:" + transaction_id,
            request_hash="0" * 64, snapshot_hash=snapshot_hash,
            policy_version=reservation["policy_version"],
            policy_hash=reservation["policy_hash"])
        command = ReconcileCommand.model_validate({**provisional.model_dump(mode="python"),
            "request_hash": semantic_request_hash("reconcile", provisional)})
        outcome = await finance.reconcile_account(command)
        if outcome["status"] != "clean":
            raise FinanceError("post-exit zero-WETH account did not reconcile")
        view = await finance.read_account_risk_snapshot(scope)
    if view["reconciliationState"] != "clean" \
            or view["observationSnapshotHash"] != snapshot_hash:
        raise FinanceError("final exit account remains unverified")
    async with finance.engine.connect() as conn:
        pending = (await conn.execute(text("""
          SELECT count(*) FROM finance_submission_attempts
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
            AND status='possible'
        """), {"account": scope.strategy_account_id})).scalar_one()
        weth = (await conn.execute(text("""
          SELECT units FROM finance_balances
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
            AND asset_unit_id=:asset AND location_id=:location AND book='wallet'
        """), {"account": scope.strategy_account_id,
               "asset": ARBITRUM_WETH_UNIT_ID,
               "location": "arbitrum:42161:wallet:" + native["ownerAddress"]})).scalar_one_or_none()
    if pending or (weth is not None and db_native_int(weth) != 0):
        raise FinanceError("native exit still has unresolved attempt or WETH exposure")
    return {"snapshotHash": snapshot_hash, "transactionId": transaction_id,
            "revision": str(view["accountRevision"]), "wethUnits": "0",
            "pendingAttemptCount": 0}
