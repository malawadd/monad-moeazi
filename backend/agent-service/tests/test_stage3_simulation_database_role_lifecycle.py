"""SQL070–078 startup-role inventory and transactional privilege-drift checks."""
from contextlib import asynccontextmanager
import os

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.simulation_database_guard import verify_simulation_database_role
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_simulation_database_role import qualification


class BorrowedEngine:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def connect(self):
        yield self.conn


@pytest.mark.asyncio
@pytest.mark.parametrize("drift,reason", [
    ("REVOKE SELECT ON simulation_phase_receipts FROM moeazi_simulation_writer",
     "lifecycle table grants"),
    ("REVOKE INSERT ON simulation_reservation_resolutions FROM moeazi_simulation_writer",
     "lifecycle table grants"),
    ("REVOKE UPDATE ON simulation_protections FROM moeazi_simulation_writer",
     "lifecycle table grants"),
    ("REVOKE SELECT ON simulation_flat_resolutions FROM moeazi_simulation_writer",
     "lifecycle table grants"),
    ("REVOKE INSERT ON simulation_flat_resolutions FROM moeazi_simulation_writer",
     "lifecycle table grants"),
    ("REVOKE SELECT ON simulation_maintenance_reductions FROM moeazi_simulation_writer",
     "lifecycle table grants"),
    ("REVOKE INSERT ON simulation_maintenance_obligation_links FROM moeazi_simulation_writer",
     "lifecycle table grants"),
    ("REVOKE SELECT ON simulation_order_ordinal_allocations FROM moeazi_simulation_writer",
     "lifecycle table grants"),
    ("GRANT UPDATE (order_ordinal) ON simulation_order_ordinal_allocations TO moeazi_q4_sim_20260930",
     "lifecycle table grants"),
    ("GRANT UPDATE (proof_json) ON simulation_flat_resolutions TO moeazi_q4_sim_20260930",
     "lifecycle table grants"),
    ("GRANT UPDATE (receipt_json) ON simulation_maintenance_reductions TO moeazi_q4_sim_20260930",
     "lifecycle table grants"),
    ("GRANT UPDATE (result_json) ON simulation_phase_receipts TO moeazi_q4_sim_20260930",
     "lifecycle table grants"),
    ("GRANT DELETE ON simulation_reservation_resolutions TO moeazi_q4_sim_20260930",
     "lifecycle table grants"),
    ("DROP POLICY simulation_experiment_only ON simulation_phase_receipts",
     "unconfined table"),
    ("DROP POLICY simulation_experiment_only ON simulation_reservation_resolutions",
     "unconfined table"),
    ("DROP POLICY simulation_experiment_only ON simulation_flat_resolutions",
     "unconfined table"),
    ("DROP POLICY simulation_maintenance_experiment ON simulation_maintenance_reductions",
     "unconfined table"),
    ("DROP POLICY simulation_maintenance_links_experiment ON simulation_maintenance_obligation_links",
     "unconfined table"),
    ("DROP POLICY simulation_ordinal_experiment ON simulation_order_ordinal_allocations",
     "unconfined table"),
])
async def test_lifecycle_table_privilege_drift_blocks_worker_startup(drift, reason):
    if not os.getenv("MOEAZI_Q4_POSTGRES_DSN"):
        pytest.skip("explicit disposable Q4 database opt-in required")
    record = qualification()
    admin = create_async_engine(guarded_dsn())
    simulation = create_async_engine(record["dsn"])
    try:
        await verify_simulation_database_role(simulation)
        async with admin.connect() as conn:
            transaction = await conn.begin()
            try:
                await conn.execute(text(drift))
                await conn.execute(text("SET LOCAL ROLE moeazi_q4_sim_20260930"))
                with pytest.raises(FinanceError, match=reason):
                    await verify_simulation_database_role(BorrowedEngine(conn))
            finally:
                await transaction.rollback()
        await verify_simulation_database_role(simulation)
    finally:
        await simulation.dispose()
        await admin.dispose()
