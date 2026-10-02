"""Private vault sidecar calls and reconciliation-only historical buy recovery."""
from __future__ import annotations

import httpx

from .finance_contracts import FinanceError, FinanceScope
from .managed_vault_buy_settlement import settle_confirmed_vault_buy


def vault_from_binding(binding: dict) -> dict:
    grant = binding["grant_id"]
    if (not isinstance(grant, str) or not grant.startswith("vault-")
            or not binding.get("vault_address")
            or not binding.get("executor_address")
            or not binding.get("order_id")):
        raise FinanceError("historical vault order binding is unavailable")
    return {"executionGrantId": grant, "mandateId": grant.removeprefix("vault-"),
        "ownerAddress": binding["owner_address"],
        "vaultAddress": binding["vault_address"],
        "executorAddress": binding["executor_address"],
        "vaultCodeHash": binding["vault_code_hash"],
        "programHash": binding["vault_program_hash"],
        "policyHash": binding["vault_policy_hash"],
        "capitalUnits": str(binding["vault_capital_units"]),
        "maxBuyUnits": str(binding["vault_max_buy_units"]),
        "mandateExpiresAt": int(binding["vault_expires_at"]),
        "orderId": binding["order_id"], "fromBlock": str(binding["from_block"])}


def vault_order_input(native: dict, quote, deadline: int) -> dict:
    return {"vaultAddress": native["vaultAddress"],
        "ownerAddress": native["ownerAddress"],
        "executorAddress": native["executorAddress"],
        "programHash": native["programHash"],
        "policyHash": native["policyHash"],
        "capitalUnits": native["capitalUnits"],
        "maxBuyUnits": native["maxBuyUnits"],
        "expiresAt": native["mandateExpiresAt"],
        "codeHash": native["vaultCodeHash"],
        "orderId": native["orderId"], "amountIn": quote.amount_in,
        "amountOutMinimum": quote.minimum_amount_out,
        "deadline": deadline}


async def vault_sidecar(settings, path: str, payload: dict,
                        *, private: bool = False, timeout: float = 30) -> dict:
    secret = (settings.managed_vault_execution_secret.get_secret_value()
              if private else settings.worker_shared_secret.get_secret_value())
    if not secret or private and len(secret) < 32:
        raise FinanceError("isolated vault sidecar credential is unavailable")
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(settings.execution_sidecar_url.rstrip("/")
            + "/internal/uniswap/" + path, json=payload,
            headers={"Authorization": "Bearer " + secret})
    if not response.is_success:
        raise FinanceError("isolated vault sidecar rejected the exact operation")
    data = response.json()
    if not isinstance(data, dict):
        raise FinanceError("vault sidecar returned no structured operation")
    return data


async def recover_vault_buy(finance, settings, scope: FinanceScope, *,
        context: dict, reservation: dict, binding: dict, quote) -> dict:
    native = vault_from_binding(binding)
    observation = await vault_sidecar(settings, "managed-vault-observe-buy",
        {**vault_order_input(native, quote, int(binding["deadline"])),
         "fromBlock": native["fromBlock"]}, private=True)
    if observation.get("orderId") != native["orderId"]:
        raise FinanceError("observed vault order differs from immutable attempt")
    if observation.get("status") != "confirmed":
        if observation.get("status") != "pending":
            raise FinanceError("vault observation returned an unknown state")
        return {"status": "executing", "reason": "finalized_vault_fill_not_yet_observed",
                "reservationId": reservation["reservation_id"],
                "retryBroadcast": False}
    proof = await settle_confirmed_vault_buy(finance, scope=scope, native=native,
        reservation=reservation, quote=quote, operation=observation,
        sidecar_read=lambda expectation: vault_sidecar(settings,
            "managed-vault-read", expectation))
    worker_url = settings.convex_worker_url.rstrip("/")
    if not worker_url.endswith("/worker"):
        raise FinanceError("Convex native receipt ingress is unavailable")
    endpoint = worker_url.removesuffix("/worker") + "/native-finance-trade/vault-confirmed"
    payload = {"proposalId": binding["proposal_id"],
        "strategyAccountId": scope.strategy_account_id,
        "assignmentId": binding["assignment_id"],
        "programVersionId": binding["program_version_id"],
        "mandateId": native["mandateId"],
        "intentId": reservation["intent_id"],
        "attemptId": reservation["attempt_id"],
        "reservationId": reservation["reservation_id"],
        "grantId": native["executionGrantId"],
        "vaultAddress": native["vaultAddress"],
        "orderId": native["orderId"],
        "transactionHash": observation["transactionHash"],
        "confirmedBlockNumber": observation["blockNumber"],
        "confirmedBlockHash": observation["blockHash"],
        "postFillSnapshotHash": proof["snapshotHash"],
        "financeRevision": str(proof["revision"]),
        "journalTransactionId": proof["transactionId"],
        "actualInputUnits": observation["actualInputUnits"],
        "actualOutputUnits": observation["actualOutputUnits"]}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(endpoint, json=payload, headers={
            "Authorization": "Bearer "
                + settings.worker_shared_secret.get_secret_value()})
    if not response.is_success:
        raise FinanceError("reconciled vault fill could not be projected to mobile")
    result = response.json()
    if not isinstance(result, dict) or not result.get("receiptId"):
        raise FinanceError("vault fill projection returned no receipt")
    return {"status": "executed", "receiptId": result["receiptId"],
            "transactionHash": observation["transactionHash"],
            "actualInputUnits": observation["actualInputUnits"],
            "actualOutputUnits": observation["actualOutputUnits"],
            "reservationId": reservation["reservation_id"],
            "retryBroadcast": False}
