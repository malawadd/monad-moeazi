"""Feature 38 uses append-only generic Test Center persistence locally."""
from .test_center_storage import save_run_on_connection
class AnalyticalDiversityRepository:
 def __init__(self, engine): self.engine=engine
 async def persist_bundle(self,payload):
  async with self.engine.begin() as connection: return await save_run_on_connection(connection,payload)
