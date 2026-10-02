"""Dedicated simulation worker; never starts analyst or native execution queues."""
from __future__ import annotations

import asyncio
from datetime import timedelta
from uuid import uuid4

from sqlalchemy.ext.asyncio import create_async_engine
from temporalio.client import Client
from temporalio.worker import Worker

from .finance_repository import FinanceRepository
from .simulation_activities import SimulationActivities
from .simulation_database_guard import verify_simulation_database_role
from .simulation_authority import SimulationEntryAuthorizer
from .simulation_product_client import SimulationProductClient
from .simulation_runtime_config import SIMULATION_QUEUE, SimulationWorkerConfig
from .simulation_workflow import SimulationSupervisorWorkflow


async def run(settings: SimulationWorkerConfig) -> None:
    if not settings.enabled:
        raise RuntimeError("The dedicated simulation worker is disabled")
    # Import only after the explicit enable gate. No shared application Settings,
    # analyst workflows, provider routing, Redis budget or signer client is loaded.
    from .lifecycle_repository import SimulationLifecycleRepository
    from .lifecycle_simulator import simulate_order

    engine = create_async_engine(settings.postgres_dsn.get_secret_value(), pool_pre_ping=True,
                                 pool_size=2, max_overflow=0, pool_timeout=10)
    finance = FinanceRepository(engine)
    product = SimulationProductClient(settings)
    try:
        await verify_simulation_database_role(finance.engine)
        repository = SimulationLifecycleRepository(finance, simulator=simulate_order,
            entry_authorizer=SimulationEntryAuthorizer(product))
        activities = SimulationActivities(repository, f"simulation-worker-{uuid4()}")
        client = await Client.connect(settings.temporal_address,
                                      namespace=settings.temporal_namespace)
        worker = Worker(client, task_queue=SIMULATION_QUEUE,
            workflows=[SimulationSupervisorWorkflow],
            activities=[activities.advance, activities.control],
            max_concurrent_activities=settings.max_concurrent_activities,
            graceful_shutdown_timeout=timedelta(seconds=30))
        await worker.run()
    finally:
        await product.aclose()
        await finance.engine.dispose()


if __name__ == "__main__":
    asyncio.run(run(SimulationWorkerConfig()))
