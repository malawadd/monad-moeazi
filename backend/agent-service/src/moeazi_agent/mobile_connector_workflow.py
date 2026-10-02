"""Operation-ID-only reconciliation; no provider secrets or signatures in Temporal."""
from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    import httpx
    from moeazi_agent.config import get_settings
    from moeazi_agent.mobile_connector_history import save_connector_history

TERMINAL = {"received", "completed", "failed", "cancelled", "expired"}


async def connector_call(action: str, operation_id: str) -> dict:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.post(
            f"{settings.execution_sidecar_url.rstrip('/')}/internal/mobile/{action}",
            headers={"authorization": f"Bearer {settings.worker_shared_secret.get_secret_value()}"},
            json={"operationId": operation_id},
        )
        response.raise_for_status()
        return response.json()


@activity.defn
async def reconcile_mobile_connector_activity(operation_id: str) -> dict:
    result = await connector_call("reconcile", operation_id)
    if result.get("history"):
        await save_connector_history(get_settings().postgres_dsn, result["history"])
    return {"status": result["status"]}


@activity.defn
async def mark_mobile_connector_attention_activity(operation_id: str) -> dict:
    return await connector_call("attention", operation_id)


@workflow.defn
class MobileConnectorWorkflow:
    @workflow.run
    async def run(self, operation_id: str) -> dict:
        for attempt in range(40):
            try:
                result = await workflow.execute_activity(
                    reconcile_mobile_connector_activity, operation_id,
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=RetryPolicy(maximum_attempts=2),
                )
                if result.get("status") in TERMINAL:
                    return result
            except Exception:
                # Provider outage is not evidence of payment or execution failure.
                pass
            await workflow.sleep(timedelta(seconds=min(120, 5 * (attempt + 1))))
        attention = await workflow.execute_activity(
            mark_mobile_connector_attention_activity, operation_id,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )
        if attention.get("status") in TERMINAL:
            return attention
        # Active uncertain work is not idle job polling. Keep its reservation and
        # inspect late settlement, with long backoff and bounded workflow history.
        await workflow.sleep(timedelta(hours=1))
        workflow.continue_as_new(operation_id)
