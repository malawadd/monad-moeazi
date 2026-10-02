"""Owner-scoped run dataset registration from already stored observation hashes."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _hash
from .lifecycle_dataset import MAX_OBSERVATIONS, register_dataset
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .observation_contracts import MarketObservation, canonical_hash


class LifecycleDatasetMixin:
    async def register_run_dataset(self, scope: FinanceScope, run_id: str,
                                   manifest_hash: str,
                                   observation_hashes: tuple[str, ...],
                                   created_by_subject: str) -> dict:
        _hash(manifest_hash)
        if scope.environment != "experiment" or not created_by_subject or \
                type(observation_hashes) is not tuple or \
                not 1 <= len(observation_hashes) <= MAX_OBSERVATIONS or \
                len(set(observation_hashes)) != len(observation_hashes):
            raise FinanceError("dataset request lacks one bounded experiment corpus")
        for observation_hash in observation_hashes:
            _hash(observation_hash)
        params = _run_params(scope, run_id)
        async with self.finance.engine.begin() as conn:
            await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            if run["manifest_hash"] != manifest_hash or \
                    run["created_by_subject"] != created_by_subject:
                raise FinanceError("dataset registration owner or run identity differs")
            manifest = SimulationRunManifest.model_validate_json(
                json.dumps(run["manifest_json"]))
            existing = (await conn.execute(text("""
                SELECT dataset_hash,observation_count FROM simulation_run_datasets
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).mappings().first()
            if existing is None and (run["entries_stopped"] or
                                     run["status"] != "registered" or
                                     run["cursor_sequence"] != 0 or
                                     run["pending_obligations"]):
                raise FinanceError("active or stopped run cannot register a new dataset")
            rows = (await conn.execute(text("""
                SELECT observation_hash,normalized_body FROM observation_market_events
                WHERE observation_hash = ANY(CAST(:hashes AS text[]))
            """), {"hashes": list(observation_hashes)})).mappings().all()
            found = {row["observation_hash"]: row for row in rows}
            if len(found) != len(observation_hashes):
                raise FinanceError("dataset request references missing source observations")
            observations = tuple(MarketObservation.model_validate(found[item]["normalized_body"])
                                 for item in observation_hashes)
            if any(canonical_hash(row.model_dump(mode="json")) != expected
                   for row, expected in zip(observations, observation_hashes)):
                raise FinanceError("dataset request source body hash differs")
            await register_dataset(conn, manifest, observations)
            return {"datasetHash": manifest.scenario.dataset_hash,
                    "observationCount": len(observations),
                    "status": "duplicate" if existing else "registered"}
