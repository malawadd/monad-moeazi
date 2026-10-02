"""Finalized stopped-vault WETH sell, exact journal fold and flat reconciliation."""
from __future__ import annotations

from datetime import datetime, timezone
import re

from sqlalchemy import text

from .account_observation_storage import AccountObservationRepository
from .arbitrum_managed_vault_observation import build_managed_vault_snapshot
from .finance_contracts import (
    FinanceError, FinanceScope, ReconcileCommand, _digest, db_native_int,
    native_int, semantic_request_hash,
)
from .finance_observation_contracts import ARBITRUM_WETH_UNIT_ID
from .managed_uniswap_exit_settlement import _fold_exit, _prior
from .managed_vault_buy_helpers import vault_sidecar


HEX32 = re.compile(r"^0x[0-9a-f]{64}$")


def vault_exit_proof(operation: dict, reservation: dict, quote, snapshot,
                     native: dict) -> tuple[dict, str]:
    if (operation.get("status") != "confirmed"
            or operation.get("orderId") != native["orderId"]
            or any(not HEX32.fullmatch(str(operation.get(key, "")))
                for key in ("orderId", "transactionHash", "blockHash"))
            or snapshot.source_account_id !=
            f"arbitrum:42161:vault:{native['vaultAddress']}"):
        raise FinanceError("finalized vault sell differs from the retained close attempt")
    block = native_int(operation.get("blockNumber"), positive=True)
    amount_in = native_int(operation.get("actualInputUnits"), positive=True)
    amount_out = native_int(operation.get("actualOutputUnits"), positive=True)
    if (amount_in != native_int(quote.amount_in, positive=True)
            or amount_out < native_int(quote.minimum_amount_out, positive=True)
            or native_int(snapshot.source_block_number, positive=True) < block
            or (native_int(snapshot.source_block_number) == block
                and snapshot.source_block_hash != operation["blockHash"])):
        raise FinanceError("vault sell event or later balance read differs")
    body = {"schemaVersion": 1, "scope": snapshot.scope.model_dump(),
        "reservationId": reservation["reservation_id"],
        "attemptId": reservation["attempt_id"],
        "intentId": reservation["intent_id"],
        "clientId": reservation["client_id"],
        "normalizedPayloadHash": reservation["normalized_payload_hash"],
        "grantId": native["executionGrantId"],
        "vaultAddress": native["vaultAddress"], "orderId": native["orderId"],
        "transactionHash": operation["transactionHash"],
        "confirmedBlockNumber": str(block),
        "confirmedBlockHash": operation["blockHash"],
        "actualInputUnits": str(amount_in),
        "actualOutputUnits": str(amount_out),
        "beforeSnapshotHash": reservation["snapshot_hash"],
        "afterSnapshotHash": snapshot.snapshot_hash}
    return body, _digest("moeazi-live-vault-exit-v1", body)


async def settle_confirmed_vault_exit(finance, settings, *, scope: FinanceScope,
        reservation: dict, quote, operation: dict, native: dict) -> dict:
    prior = await _prior(finance, scope, reservation["reservation_id"])
    if prior:
        if (prior["attempt_id"] != reservation["attempt_id"]
                or prior["transaction_hash"] != operation.get("transactionHash")
                or prior["vault_address"] != native["vaultAddress"]
                or prior["order_id"] != native["orderId"]):
            raise FinanceError("vault exit conflicts with immutable prior proof")
        snapshot_hash = prior["after_snapshot_hash"]
        transaction_id = prior["journal_transaction_id"]
    else:
        expectation = {key: native[key] for key in ("vaultAddress", "ownerAddress",
            "executorAddress", "codeHash", "programHash", "policyHash",
            "capitalUnits", "maxBuyUnits", "expiresAt")}
        raw = await vault_sidecar(settings, "managed-vault-read", expectation)
        if raw.get("stopped") is not True:
            raise FinanceError("Magic vault is not stopped after its sell")
        snapshot = build_managed_vault_snapshot(raw, scope=scope,
            expected_vault=native["vaultAddress"],
            expected_owner=native["ownerAddress"],
            expected_executor=native["executorAddress"],
            expected_program_hash="0x" + native["programHash"],
            expected_policy_hash="0x" + native["policyHash"],
            expected_code_hash=native["codeHash"],
            capital_units=native["capitalUnits"],
            max_buy_units=native["maxBuyUnits"],
            mandate_expires_at=native["expiresAt"],
            policy_version=reservation["policy_version"],
            received_at=datetime.now(timezone.utc))
        await AccountObservationRepository(finance.engine).store_native_snapshot(snapshot)
        proof, digest = vault_exit_proof(operation, reservation, quote,
                                         snapshot, native)
        epoch = await finance.acquire_writer_epoch(scope,
            "native-uniswap-activation-v1")
        transaction_id = await _fold_exit(finance, scope, reservation,
            {"transactionHash": operation["transactionHash"]},
            snapshot, proof, digest, epoch)
        snapshot_hash = snapshot.snapshot_hash
    view = await finance.read_account_risk_snapshot(scope)
    if (view["reconciliationState"] != "clean"
            or view["observationSnapshotHash"] != snapshot_hash):
        epoch = await finance.acquire_writer_epoch(scope,
            "native-uniswap-activation-v1")
        provisional = ReconcileCommand.model_construct(scope=scope,
            expected_revision=native_int(view["accountRevision"], nonnegative=True),
            writer_epoch=epoch,
            idempotency_key="native-vault-exit-reconcile:" + transaction_id,
            request_hash="0" * 64, snapshot_hash=snapshot_hash,
            policy_version=reservation["policy_version"],
            policy_hash=reservation["policy_hash"])
        command = ReconcileCommand.model_validate({**provisional.model_dump(mode="python"),
            "request_hash": semantic_request_hash("reconcile", provisional)})
        result = await finance.reconcile_account(command)
        if result["status"] != "clean":
            raise FinanceError("post-sell Magic vault did not reconcile flat")
        view = await finance.read_account_risk_snapshot(scope)
    if (view["reconciliationState"] != "clean"
            or view["observationSnapshotHash"] != snapshot_hash):
        raise FinanceError("final Magic vault exit account remains unverified")
    async with finance.engine.connect() as conn:
        pending = (await conn.execute(text("""
          SELECT 1 FROM finance_submission_attempts WHERE environment='live'
            AND scope_id='live' AND strategy_account_id=:account
            AND status IN ('possible','dispatching') LIMIT 1
        """), {"account": scope.strategy_account_id})).first()
        weth = (await conn.execute(text("""
          SELECT units FROM finance_balances WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account AND asset_unit_id=:asset
            AND location_id=:location AND book='wallet'
        """), {"account": scope.strategy_account_id,
            "asset": ARBITRUM_WETH_UNIT_ID,
            "location": f"arbitrum:42161:vault:{native['vaultAddress']}"})).scalar_one_or_none()
    if pending or weth is None or db_native_int(weth) != 0:
        raise FinanceError("Magic vault exit still has exposure or unresolved submission")
    return {"snapshotHash": snapshot_hash, "transactionId": transaction_id,
        "revision": str(view["accountRevision"]), "wethUnits": "0",
        "pendingAttemptCount": 0}
