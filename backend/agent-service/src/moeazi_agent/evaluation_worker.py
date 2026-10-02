import asyncio

from temporalio.client import Client
from temporalio.worker import Worker

from .config import get_settings
from .evaluation_temporal import (
    EvaluationExperimentWorkflow, prepare_evaluation_activity,
    run_evaluation_market_activity, set_evaluation_status_activity,
    settle_evaluation_activity,
)
from .evaluation_v2_temporal import (
    EvaluationExperimentV2Workflow, prepare_v2_activity,
    release_v2_budget_activity, run_v2_plan_item_activity, set_v2_status_activity,
)


async def run() -> None:
    settings = get_settings()
    client = await Client.connect(
        settings.temporal_address, namespace=settings.temporal_namespace,
    )
    worker = Worker(
        client, task_queue=settings.evaluation_task_queue,
        workflows=[EvaluationExperimentWorkflow, EvaluationExperimentV2Workflow],
        activities=[
            prepare_evaluation_activity, set_evaluation_status_activity,
            run_evaluation_market_activity, settle_evaluation_activity,
            prepare_v2_activity, run_v2_plan_item_activity,
            release_v2_budget_activity, set_v2_status_activity,
        ],
    )
    await worker.run()


if __name__ == "__main__":
    asyncio.run(run())
