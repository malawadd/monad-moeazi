"""Fold a finalized Magic-owner vault return into the stopped financial account."""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
import re

from sqlalchemy import text

from .account_observation_storage import AccountObservationRepository
from .arbitrum_managed_vault_observation import build_managed_vault_snapshot
from .finance_contracts import (FinanceError, FinanceScope, JournalCommand,
    JournalPosting, ReconcileCommand, _digest, native_int,
    semantic_request_hash, source_event_digest)
from .finance_observation_contracts import ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID
from .finance_oracle import balanced_postings, projected_balances
from .managed_vault_buy_helpers import vault_sidecar


HEX32 = re.compile(r"^0x[0-9a-f]{64}$")


def release_proof(operation: dict, snapshot, context: dict) -> tuple[dict, str]:
    location = f"arbitrum:42161:vault:{context['vaultAddress']}"
    if (operation.get("status") != "confirmed"
            or operation.get("ownerAddress") != context["ownerAddress"]
            or operation.get("vaultAddress") != context["vaultAddress"]
            or snapshot.source_account_id != location
            or any(not HEX32.fullmatch(str(operation.get(key, "")))
                for key in ("transactionHash", "blockHash"))):
        raise FinanceError("finalized Magic owner release identity differs")
    block = native_int(operation.get("blockNumber"), positive=True)
    amount = native_int(operation.get("amountUnits"), positive=True)
    if (native_int(snapshot.source_block_number, positive=True) < block
            or (native_int(snapshot.source_block_number) == block
                and snapshot.source_block_hash != operation["blockHash"])):
        raise FinanceError("vault release has no later finalized balance read")
    observed = {(row.asset_unit_id, row.location_id, row.book):
        native_int(row.units, nonnegative=True) for row in snapshot.observed_balances}
    if (observed.get((ARBITRUM_USDC_UNIT_ID, location, "wallet")) != 0
            or observed.get((ARBITRUM_WETH_UNIT_ID, location, "wallet")) != 0):
        raise FinanceError("Magic vault retains capital or exposure after release")
    body = {"schemaVersion": 1, "scope": snapshot.scope.model_dump(),
        "mandateId": context["mandateId"], "vaultAddress": context["vaultAddress"],
        "ownerAddress": context["ownerAddress"], "transactionHash": operation["transactionHash"],
        "confirmedBlockNumber": str(block), "confirmedBlockHash": operation["blockHash"],
        "amountUnits": str(amount), "afterSnapshotHash": snapshot.snapshot_hash}
    return body, _digest("moeazi-live-vault-owner-release-v1", body)


async def _fold_release(finance, scope: FinanceScope, context: dict,
                        snapshot, proof: dict, proof_hash: str, epoch: int) -> tuple[str, str]:
    location = snapshot.source_account_id
    registration = {(row.asset_unit_id, row.location_id, row.book): row.registry_hash
                    for row in snapshot.observed_balances}
    registry = registration.get((ARBITRUM_USDC_UNIT_ID, location, "wallet"))
    if not registry:
        raise FinanceError("vault USDC registry is unavailable")
    amount = native_int(proof["amountUnits"], positive=True)
    postings = (JournalPosting(asset_unit_id=ARBITRUM_USDC_UNIT_ID,
        registry_hash=registry, location_id=location, book="wallet", units=str(-amount)),
        JournalPosting(asset_unit_id=ARBITRUM_USDC_UNIT_ID,
            registry_hash=registry, location_id=location, book="external", units=str(amount)))
    balanced_postings(postings)
    provisional = JournalCommand.model_construct(scope=scope, expected_revision=0,
        writer_epoch=epoch, idempotency_key="native-vault-return:" + proof_hash,
        request_hash="0" * 64, source_owner=location,
        source_stream="arbitrum:42161:managed-vault-owner-release",
        source_event_id=proof["transactionHash"],
        source_revision=proof["confirmedBlockHash"], source_event_hash="0" * 64,
        source_payload_hash=proof_hash, kind="withdrawal",
        observed_at=snapshot.event_at, postings=postings, reverses_transaction_id=None)
    source_hash = source_event_digest(provisional)
    transaction_id = sha256(("journal:live:live:" + scope.strategy_account_id
        + ":" + source_hash).encode()).hexdigest()
    async with finance.engine.begin() as conn:
        account = await finance._lock(conn, scope)
        await finance._writer(conn, account, epoch)
        prior = (await conn.execute(text("""
          SELECT * FROM finance_live_vault_owner_releases WHERE environment='live'
            AND scope_id='live' AND strategy_account_id=:account AND mandate_id=:mandate
        """), {"account": scope.strategy_account_id,
            "mandate": context["mandateId"]})).mappings().first()
        if prior:
            if (prior["transaction_hash"] != proof["transactionHash"]
                    or str(prior["amount_units"]) != proof["amountUnits"]
                    or str(prior["confirmed_block_number"]) != proof["confirmedBlockNumber"]
                    or prior["confirmed_block_hash"] != proof["confirmedBlockHash"]
                    or prior["vault_address"] != context["vaultAddress"]
                    or prior["owner_address"] != context["ownerAddress"]):
                raise FinanceError("Magic vault release conflicts with prior finance proof")
            return prior["journal_transaction_id"], prior["after_snapshot_hash"]
        pending = (await conn.execute(text("""
          SELECT 1 FROM finance_submission_attempts WHERE environment='live'
            AND scope_id='live' AND strategy_account_id=:account
            AND status IN ('possible','dispatching') LIMIT 1
        """), {"account": scope.strategy_account_id})).first()
        if (account["source_account_id"] != location
                or account["admission_state"] != "stopped"
                or account["reconciliation_state"] != "clean"
                or pending):
            raise FinanceError("stopped vault account is not clean before owner release")
        current = await finance._current_balances(conn, scope)
        key = (ARBITRUM_USDC_UNIT_ID, location, "wallet")
        weth_key = (ARBITRUM_WETH_UNIT_ID, location, "wallet")
        projected = projected_balances(current, postings)
        if (current.get(key, 0) != amount or current.get(weth_key, 0) != 0
                or projected.get(key, 0) != 0):
            raise FinanceError("owner release does not consume exact reconciled vault USDC")
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
            :payload,'withdrawal',:observed)
        """), {"account": scope.strategy_account_id, "source": source_hash,
            "owner": location, "stream": command.source_stream,
            "event": command.source_event_id, "source_revision": command.source_revision,
            "payload": proof_hash, "observed": snapshot.event_at})
        await conn.execute(text("""
          INSERT INTO finance_journal_transactions(environment,scope_id,strategy_account_id,
            transaction_id,source_event_hash,posting_count,request_hash,account_revision)
          VALUES('live','live',:account,:transaction,:source,2,:request,:revision)
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
          INSERT INTO finance_live_vault_owner_releases(environment,scope_id,
            strategy_account_id,mandate_id,vault_address,owner_address,
            transaction_hash,confirmed_block_number,confirmed_block_hash,
            amount_units,proof_hash,before_snapshot_hash,after_snapshot_hash,
            journal_transaction_id,proof_json)
          VALUES('live','live',:account,:mandate,:vault,:owner,:tx,:block,:block_hash,
            :amount,:proof,:before,:after,:journal,CAST(:body AS jsonb))
        """), {"account": scope.strategy_account_id,
            "mandate": context["mandateId"], "vault": context["vaultAddress"],
            "owner": context["ownerAddress"], "tx": proof["transactionHash"],
            "block": proof["confirmedBlockNumber"], "block_hash": proof["confirmedBlockHash"],
            "amount": proof["amountUnits"], "proof": proof_hash,
            "before": account["observation_snapshot_hash"], "after": snapshot.snapshot_hash,
            "journal": transaction_id,
            "body": json.dumps(proof, sort_keys=True, separators=(",", ":"))})
        updated = await finance._advance(conn, scope, epoch, account,
            reconciliation_state="unknown", reconciliation_reason="journal_ahead_of_observation")
        await finance._outbox(conn, scope, updated)
    return transaction_id, snapshot.snapshot_hash


async def settle_vault_owner_release(finance, settings, *, context: dict,
                                      operation: dict) -> dict:
    scope = FinanceScope(environment="live", scope_id="live",
        strategy_account_id=context["strategyAccountId"])
    expectation = {key: context[key] for key in ("vaultAddress", "ownerAddress",
        "executorAddress", "codeHash", "programHash", "policyHash",
        "capitalUnits", "maxBuyUnits", "expiresAt")}
    raw = await vault_sidecar(settings, "managed-vault-read", expectation)
    if raw.get("stopped") is not True or raw.get("vaultUsdcUnits") != "0" \
            or raw.get("vaultWethUnits") != "0":
        raise FinanceError("Magic vault has not finalized an empty balance")
    async with finance.engine.connect() as conn:
        account = (await conn.execute(text("""
          SELECT policy_version,policy_hash FROM finance_accounts WHERE environment='live'
            AND scope_id='live' AND strategy_account_id=:account
        """), {"account": scope.strategy_account_id})).mappings().first()
    if not account:
        raise FinanceError("Magic vault financial account is unavailable")
    snapshot = build_managed_vault_snapshot(raw, scope=scope,
        expected_vault=context["vaultAddress"], expected_owner=context["ownerAddress"],
        expected_executor=context["executorAddress"],
        expected_program_hash="0x" + context["programHash"],
        expected_policy_hash="0x" + context["policyHash"],
        expected_code_hash=context["codeHash"], capital_units=context["capitalUnits"],
        max_buy_units=context["maxBuyUnits"], mandate_expires_at=context["expiresAt"],
        policy_version=account["policy_version"], received_at=datetime.now(timezone.utc))
    await AccountObservationRepository(finance.engine).store_native_snapshot(snapshot)
    proof, digest = release_proof(operation, snapshot, context)
    epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
    journal, settled_snapshot_hash = await _fold_release(
        finance, scope, context, snapshot, proof, digest, epoch)
    view = await finance.read_account_risk_snapshot(scope)
    if view["reconciliationState"] != "clean" or view["observationSnapshotHash"] != settled_snapshot_hash:
        epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
        provisional = ReconcileCommand.model_construct(scope=scope,
            expected_revision=native_int(view["accountRevision"], nonnegative=True),
            writer_epoch=epoch, idempotency_key="native-vault-return-reconcile:" + journal,
            request_hash="0" * 64, snapshot_hash=settled_snapshot_hash,
            policy_version=account["policy_version"], policy_hash=account["policy_hash"])
        command = ReconcileCommand.model_validate({**provisional.model_dump(mode="python"),
            "request_hash": semantic_request_hash("reconcile", provisional)})
        result = await finance.reconcile_account(command)
        if result["status"] != "clean":
            raise FinanceError("empty Magic vault did not reconcile")
        view = await finance.read_account_risk_snapshot(scope)
    if view["reconciliationState"] != "clean" or view["observationSnapshotHash"] != settled_snapshot_hash:
        raise FinanceError("Magic vault release finance state remains unknown")
    return {"financeSnapshotHash": settled_snapshot_hash,
        "journalTransactionId": journal, "financeRevision": str(view["accountRevision"]),
        "amountUnits": proof["amountUnits"],
        "transactionHash": proof["transactionHash"],
        "finalizedBlockNumber": proof["confirmedBlockNumber"],
        "finalizedBlockHash": proof["confirmedBlockHash"]}
