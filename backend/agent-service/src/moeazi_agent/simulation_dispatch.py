"""Start or recover one stable simulation supervisor without replacing its history."""
from __future__ import annotations

from temporalio.client import Client
from temporalio.common import WorkflowIDReusePolicy
from temporalio.exceptions import WorkflowAlreadyStartedError

from .finance_contracts import FinanceError, FinanceScope
from .simulation_runtime_config import (
    SIMULATION_QUEUE, SIMULATION_WORKFLOW, simulation_workflow_id,
)
from .simulation_workflow_contracts import SimulationWorkflowInput


async def ensure_simulation_supervisor(
    client: Client, scope: FinanceScope, run_id: str, manifest_hash: str,
) -> dict:
    """Call after immutable run registration. A repeated start cannot replay economics."""
    payload = SimulationWorkflowInput(scope=scope, run_id=run_id, manifest_hash=manifest_hash)
    workflow_id = simulation_workflow_id(scope, run_id)
    memo = {"environment": "experiment", "manifest_hash": manifest_hash,
            "run_id": run_id, "scope_hash": workflow_id.removeprefix("simulation-v1:")}
    try:
        await client.start_workflow(
            SIMULATION_WORKFLOW, payload.model_dump(mode="json"), id=workflow_id,
            task_queue=SIMULATION_QUEUE, id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
            memo=memo,
        )
        duplicate = False
    except WorkflowAlreadyStartedError:
        description = await client.get_workflow_handle(workflow_id).describe()
        if await description.memo() != memo:
            raise FinanceError("Existing simulation supervisor has different immutable identity")
        duplicate = True
    # RPC uncertainty propagates. Retry with this same scope/run identity; never a new ID.
    return {"workflow_id": workflow_id, "duplicate": duplicate,
            "status": "supervisor_requested", "execution_qualified": False}
