from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    import httpx
    from moeazi_agent.config import get_settings
    from moeazi_agent.convex import ConvexWorkerClient

USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
TERMINAL = {"completed", "failed", "cancelled", "expired", "needs_attention"}


async def _rpc(client: httpx.AsyncClient, method: str, params: list):
    response = await client.post("", json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    response.raise_for_status()
    payload = response.json()
    if payload.get("error") or "result" not in payload:
        raise RuntimeError(payload.get("error", {}).get("message", "Arbitrum returned an incomplete response"))
    return payload["result"]


def _address_topic(value: str) -> str:
    return "0x" + value.lower().removeprefix("0x").rjust(64, "0")


async def _find_uncertain(rpc: httpx.AsyncClient, row: dict) -> str | None:
    latest = int(await _rpc(rpc, "eth_blockNumber", []), 16)
    transaction = __import__("json").loads(row["transactionJson"])
    for number in range(latest, max(row["observedBlock"], latest - 64) - 1, -1):
        block = await _rpc(rpc, "eth_getBlockByNumber", [hex(number), True])
        for candidate in (block or {}).get("transactions", []):
            if (candidate.get("from", "").lower() == row["ownerAddress"].lower()
                    and int(candidate.get("nonce", "0x0"), 16) == row["expectedNonce"]
                    and candidate.get("to", "").lower() == USDC
                    and candidate.get("input", "").lower() == transaction["data"].lower()):
                return candidate["hash"].lower()
    return None


@activity.defn
async def reconcile_mobile_withdrawal_activity(operation_id: str) -> dict:
    settings = get_settings()
    convex = ConvexWorkerClient(settings)
    row = await convex.command("getMobileWithdrawalForWorker", operationId=operation_id)
    if not row or row["status"] in TERMINAL:
        return {"status": row["status"] if row else "missing"}
    if not settings.arbitrum_rpc_url:
        raise RuntimeError("ARBITRUM_RPC_URL is required for withdrawal reconciliation")
    async with httpx.AsyncClient(base_url=settings.arbitrum_rpc_url, timeout=10) as rpc:
        tx_hash = row.get("txHash")
        if not tx_hash and row["status"] == "uncertain":
            tx_hash = await _find_uncertain(rpc, row)
        if not tx_hash:
            return {"status": "pending"}
        receipt = await _rpc(rpc, "eth_getTransactionReceipt", [tx_hash])
        if receipt is None:
            await convex.command("updateMobileWithdrawalStatus", operationId=operation_id,
                                 status="confirming", txHash=tx_hash)
            return {"status": "pending"}
        transaction = await _rpc(rpc, "eth_getTransactionByHash", [tx_hash])
        expected = __import__("json").loads(row["transactionJson"])
        valid_tx = (transaction and transaction.get("from", "").lower() == row["ownerAddress"].lower()
                    and transaction.get("to", "").lower() == USDC
                    and transaction.get("input", "").lower() == expected["data"].lower())
        valid_log = any(
            log.get("address", "").lower() == USDC
            and [item.lower() for item in log.get("topics", [])[:3]] == [
                TRANSFER_TOPIC, _address_topic(row["ownerAddress"]), _address_topic(row["destination"])]
            and int(log.get("data", "0x0"), 16) == int(row["amountRaw"])
            for log in receipt.get("logs", [])
        )
        if receipt.get("status") != "0x1" or not valid_tx or not valid_log:
            await convex.command("updateMobileWithdrawalStatus", operationId=operation_id,
                                 status="failed", txHash=tx_hash, failureCode="RECEIPT_MISMATCH",
                                 failureMessage="Arbitrum did not confirm the exact USDC transfer.")
            return {"status": "failed"}
        await convex.command("updateMobileWithdrawalStatus", operationId=operation_id,
                             status="completed", txHash=tx_hash)
        return {"status": "completed"}


@activity.defn
async def mark_mobile_withdrawal_attention_activity(operation_id: str) -> dict:
    settings = get_settings()
    await ConvexWorkerClient(settings).command(
        "updateMobileWithdrawalStatus", operationId=operation_id, status="needs_attention",
        failureCode="RECONCILIATION_TIMEOUT",
        failureMessage="Confirmation is taking longer than expected. No retry was broadcast.",
    )
    return {"status": "needs_attention"}


@workflow.defn
class MobileWithdrawalWorkflow:
    @workflow.run
    async def run(self, operation_id: str) -> dict:
        for attempt in range(40):
            result = await workflow.execute_activity(
                reconcile_mobile_withdrawal_activity, operation_id,
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
            if result["status"] not in {"pending"}:
                return result
            await workflow.sleep(timedelta(seconds=5 if attempt < 12 else 15))
        return await workflow.execute_activity(
            mark_mobile_withdrawal_attention_activity, operation_id,
            start_to_close_timeout=timedelta(seconds=20),
        )
