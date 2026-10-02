"""Feature 36 append-only local run persistence, sharing the generic atomic run transaction."""
from .test_center_storage import save_run_on_connection
class PromotionRepository:
    def __init__(self, engine): self.engine=engine
    async def persist_bundle(self, payload):
        async with self.engine.begin() as connection: return await save_run_on_connection(connection,payload)
