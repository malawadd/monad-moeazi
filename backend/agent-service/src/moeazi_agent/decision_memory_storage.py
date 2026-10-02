"""Append-only local repository boundary for Feature 35 fixture bundles."""
from __future__ import annotations
from .test_center_storage import save_run_on_connection


class DecisionMemoryRepository:
    def __init__(self, engine): self.engine = engine

    async def persist_bundle(self, payload: dict) -> dict:
        """The generic run and its immutable feature payload share one transaction."""
        async with self.engine.begin() as connection:
            return await save_run_on_connection(connection, payload)
