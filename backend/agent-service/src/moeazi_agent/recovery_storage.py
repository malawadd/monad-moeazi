from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .dependency_safety_contracts import digest
from .test_center_common import sanitize_artifact


class RecoveryRepository:
    """Timescale is the sole immutable owner of local recovery-drill history."""

    def __init__(self, engine: AsyncEngine):
        self.engine = engine

    async def save_bundle(self, run: dict, artifacts: list[dict], transitions: list[dict]) -> dict:
        for artifact in artifacts:
            artifact["payload"] = sanitize_artifact(artifact["payload"])
        async with self.engine.begin() as conn:
            inserted = (await conn.execute(text("""
                INSERT INTO agent_test_center_runs
                  (run_id,operator_test_id,feature_id,scenario_id,mode,repository_sha,
                   registry_version,registry_hash,control_hash,fixture_hash,safe_environment,
                   invariant_verdict,idempotency_key,request_hash,payload)
                VALUES (:runId,:operatorTestId,:featureId,:scenarioId,:mode,:repositorySha,
                  :registryVersion,:registryHash,:controlHash,:fixtureHash,:safeEnvironment,
                  :invariantVerdict,:idempotencyKey,:requestHash,CAST(:payload AS jsonb))
                ON CONFLICT (operator_test_id,idempotency_key) DO NOTHING
                RETURNING request_hash,payload
            """), {**run, "payload": json.dumps(run, sort_keys=True)})).first()
            if not inserted:
                existing = (await conn.execute(text("""
                    SELECT request_hash,payload FROM agent_test_center_runs
                    WHERE operator_test_id=:operator AND idempotency_key=:key
                """), {"operator": run["operatorTestId"], "key": run["idempotencyKey"]})).first()
                if not existing or existing.request_hash != run["requestHash"]:
                    raise RuntimeError("Test Center idempotency key conflict")
                return dict(existing.payload)
            for index, artifact in enumerate(artifacts, 1):
                await conn.execute(text("""
                    INSERT INTO recovery_artifacts
                      (artifact_id,artifact_kind,run_id,scope_key,domain_id,produced_at,
                       idempotency_key,canonical_hash,payload)
                    VALUES (:id,:kind,:run,:scope,:domain,:produced,:key,:hash,CAST(:payload AS jsonb))
                    ON CONFLICT (canonical_hash) DO NOTHING
                """), {"id": f"rca_{digest({'run': run['runId'], 'index': index})[:48]}",
                    "kind": artifact["kind"], "run": run["runId"], "scope": artifact["scopeKey"],
                    "domain": artifact.get("domainId"), "produced": artifact["producedAt"],
                    "key": f"{run['idempotencyKey']}:{index}", "hash": artifact["canonicalHash"],
                    "payload": json.dumps(artifact["payload"], sort_keys=True)})
            for event in transitions:
                await conn.execute(text("""
                    INSERT INTO recovery_run_events
                      (event_id,run_id,sequence,state,artifact_hash,occurred_at,payload)
                    VALUES (:id,:run,:sequence,:state,:hash,:occurred,CAST(:payload AS jsonb))
                    ON CONFLICT (run_id,sequence) DO NOTHING
                """), {"id": f"rce_{digest({'run': run['runId'], 'sequence': event['sequence']})[:48]}",
                    "run": run["runId"], "sequence": event["sequence"], "state": event["state"],
                    "hash": event["artifactHash"], "occurred": event["occurredAt"],
                    "payload": json.dumps(event["payload"], sort_keys=True)})
                await conn.execute(text("""
                    INSERT INTO agent_test_center_events
                      (event_id,run_id,feature_id,sequence,event_type,payload)
                    VALUES (:id,:run,:feature,:sequence,:type,CAST(:payload AS jsonb))
                    ON CONFLICT (run_id,sequence) DO NOTHING
                """), {"id": f"tce_{digest({'run': run['runId'], 'sequence': event['sequence']})[:48]}",
                    "run": run["runId"], "feature": run["featureId"],
                    "sequence": event["sequence"], "type": event["state"],
                    "payload": json.dumps({"sequence": event["sequence"],
                        "eventType": event["state"], "status": "complete"}, sort_keys=True)})
            return run


def transition_rows(states: list[str], hashes: list[str], now: datetime) -> list[dict]:
    return [{"sequence": index + 1, "state": state,
        "artifactHash": hashes[min(index, len(hashes) - 1)], "occurredAt": now,
        "payload": {"state": state}} for index, state in enumerate(states)]
