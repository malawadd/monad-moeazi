"""Fold a finalized Magic-owned vault buy into the live financial account."""
from __future__ import annotations

from datetime import datetime, timezone
import re

from .account_observation_storage import AccountObservationRepository
from .arbitrum_managed_vault_observation import build_managed_vault_snapshot
from .finance_contracts import (
    FinanceError, FinanceScope, ReconcileCommand, _digest, native_int,
    semantic_request_hash,
)
from .managed_uniswap_buy_settlement import _existing_proof, _fold_native_buy


_HEX32 = re.compile(r"^0x[0-9a-f]{64}$")


def vault_fill_proof(operation: dict, reservation: dict, quote, snapshot,
                     native: dict) -> tuple[dict, str]:
    if (operation.get("status") != "confirmed"
            or operation.get("orderId") != native.get("orderId")
            or not _HEX32.fullmatch(str(operation.get("orderId", "")))
            or not _HEX32.fullmatch(str(operation.get("transactionHash", "")))
            or not _HEX32.fullmatch(str(operation.get("blockHash", "")))
            or snapshot.source_account_id !=
            f"arbitrum:42161:vault:{native['vaultAddress']}"):
        raise FinanceError("finalized vault event differs from the reserved order")
    block = native_int(operation.get("blockNumber"), positive=True)
    amount_in = native_int(operation.get("actualInputUnits"), positive=True)
    amount_out = native_int(operation.get("actualOutputUnits"), positive=True)
    if (amount_in != native_int(quote.amount_in, positive=True)
            or amount_out < native_int(quote.minimum_amount_out, positive=True)
            or native_int(snapshot.source_block_number, positive=True) < block
            or snapshot.source_block_number == str(block)
            and snapshot.source_block_hash != operation["blockHash"]):
        raise FinanceError("vault fill or later account observation differs")
    body = {"schemaVersion": 1, "scope": snapshot.scope.model_dump(),
        "reservationId": reservation["reservation_id"],
        "attemptId": reservation["attempt_id"],
        "intentId": reservation["intent_id"], "clientId": reservation["client_id"],
        "normalizedPayloadHash": reservation["normalized_payload_hash"],
        "grantId": native["executionGrantId"],
        "vaultAddress": native["vaultAddress"], "orderId": operation["orderId"],
        "transactionHash": operation["transactionHash"],
        "confirmedBlockNumber": str(block),
        "confirmedBlockHash": operation["blockHash"],
        "actualInputUnits": str(amount_in), "actualOutputUnits": str(amount_out),
        "beforeSnapshotHash": reservation["snapshot_hash"],
        "afterSnapshotHash": snapshot.snapshot_hash}
    return body, _digest("moeazi-live-vault-fill-v1", body)


async def settle_confirmed_vault_buy(finance, *, scope: FinanceScope, native: dict,
        reservation: dict, quote, operation: dict, sidecar_read) -> dict:
    prior = await _existing_proof(finance, scope, reservation["reservation_id"])
    if prior:
        if (prior["transaction_hash"] != operation.get("transactionHash")
                or prior["attempt_id"] != reservation["attempt_id"]
                or prior["vault_address"] != native["vaultAddress"]):
            raise FinanceError("vault fill conflicts with prior settlement")
        snapshot_hash, transaction_id = prior["after_snapshot_hash"], prior["journal_transaction_id"]
    else:
        expectation = {"vaultAddress": native["vaultAddress"],
            "ownerAddress": native["ownerAddress"],
            "executorAddress": native["executorAddress"],
            "programHash": native["programHash"],
            "policyHash": native["policyHash"],
            "capitalUnits": native["capitalUnits"],
            "maxBuyUnits": native["maxBuyUnits"],
            "expiresAt": native["mandateExpiresAt"],
            "codeHash": native["vaultCodeHash"]}
        raw = await sidecar_read(expectation)
        snapshot = build_managed_vault_snapshot(raw, scope=scope,
            expected_vault=native["vaultAddress"],
            expected_owner=native["ownerAddress"],
            expected_executor=native["executorAddress"],
            expected_program_hash="0x" + native["programHash"],
            expected_policy_hash="0x" + native["policyHash"],
            expected_code_hash=native["vaultCodeHash"],
            capital_units=native["capitalUnits"],
            max_buy_units=native["maxBuyUnits"],
            mandate_expires_at=native["mandateExpiresAt"],
            policy_version=reservation["policy_version"],
            received_at=datetime.now(timezone.utc))
        await AccountObservationRepository(finance.engine).store_native_snapshot(snapshot)
        proof, proof_hash = vault_fill_proof(operation, reservation, quote, snapshot, native)
        epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
        folded = await _fold_native_buy(finance, scope, reservation,
                                        {"transactionHash": operation["transactionHash"]},
                                        quote, snapshot, proof, proof_hash, epoch)
        snapshot_hash, transaction_id = folded["snapshotHash"], folded["transactionId"]
    state = await finance.read_account_risk_snapshot(scope)
    if state["reconciliationState"] == "clean" \
            and state["observationSnapshotHash"] == snapshot_hash:
        return {"snapshotHash": snapshot_hash, "transactionId": transaction_id,
                "revision": state["accountRevision"]}
    epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
    revision = native_int(state["accountRevision"], nonnegative=True)
    provisional = ReconcileCommand.model_construct(scope=scope,
        expected_revision=revision, writer_epoch=epoch,
        idempotency_key="native-vault-fill-reconcile:" + transaction_id,
        request_hash="0" * 64, snapshot_hash=snapshot_hash,
        policy_version=reservation["policy_version"],
        policy_hash=reservation["policy_hash"])
    command = ReconcileCommand.model_validate({**provisional.model_dump(mode="python"),
        "request_hash": semantic_request_hash("reconcile", provisional)})
    result = await finance.reconcile_account(command)
    if result["status"] != "clean":
        raise FinanceError("vault post-fill account did not reconcile cleanly")
    return {"snapshotHash": snapshot_hash, "transactionId": transaction_id,
            "revision": str(result["revision"])}
