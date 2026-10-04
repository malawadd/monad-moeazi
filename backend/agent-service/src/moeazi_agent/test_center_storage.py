from __future__ import annotations

import json
import re

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .dependency_safety_contracts import digest
from .test_center_common import sanitize_artifact
from .test_center_public import public_run_response


async def save_run_on_connection(conn, payload: dict) -> dict:
    """Persist one frozen Test Center run on a caller-owned transaction."""
    inserted = (await conn.execute(text("""
        INSERT INTO agent_test_center_runs
          (run_id,operator_test_id,feature_id,scenario_id,mode,repository_sha,
           registry_version,registry_hash,control_hash,fixture_hash,safe_environment,
           invariant_verdict,idempotency_key,request_hash,payload)
        VALUES (:runId,:operatorTestId,:featureId,:scenarioId,:mode,:repositorySha,
          :registryVersion,:registryHash,:controlHash,:fixtureHash,:safeEnvironment,
          :invariantVerdict,:idempotencyKey,:requestHash,CAST(:payload AS jsonb))
        ON CONFLICT (operator_test_id,idempotency_key) DO NOTHING RETURNING request_hash,payload
    """), {**payload, "payload": json.dumps(payload, sort_keys=True)})).first()
    if inserted:
        for event in payload["events"]:
            await conn.execute(text("""INSERT INTO agent_test_center_events
                (event_id,run_id,feature_id,sequence,event_type,payload)
                VALUES (:id,:run,:feature,:sequence,:type,CAST(:payload AS jsonb)) ON CONFLICT DO NOTHING"""),
                {"id": f"tce_{digest({'run': payload['runId'], 'sequence': event['sequence']})[:48]}",
                 "run": payload["runId"], "feature": payload["featureId"], "sequence": event["sequence"],
                 "type": event["eventType"], "payload": json.dumps(event, sort_keys=True)})
        return public_run_response(payload)
    existing = (await conn.execute(text("""SELECT request_hash,payload FROM agent_test_center_runs
        WHERE operator_test_id=:operator AND idempotency_key=:key"""),
        {"operator": payload["operatorTestId"], "key": payload["idempotencyKey"]})).first()
    if not existing or existing.request_hash != payload["requestHash"]:
        raise RuntimeError("Test Center idempotency key conflict")
    return public_run_response(dict(existing.payload))


class TestCenterRepository:
    def __init__(self, engine: AsyncEngine):
        self.engine = engine

    async def save_control(self, operator_id: str, feature_id: str, change: dict) -> None:
        current, previous = change["current"], change["previous"]
        body = sanitize_artifact({"featureId": feature_id,
            "requestedMode": current["requestedMode"],
            "effectiveMode": current["effectiveMode"], "layers": current["layers"],
            "registryVersion": current["registryVersion"], "registryHash": current["registryHash"],
            "prerequisiteBindings": current["prerequisiteBindings"]})
        change_id = f"tcc_{digest({'operator': operator_id, 'feature': feature_id, 'hash': current['controlHash']})[:48]}"
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO agent_test_center_control_changes
                  (change_id,operator_test_id,feature_id,previous_hash,control_hash,revision,
                   expires_at,payload) VALUES (:id,:operator,:feature,:previous,:current,
                   :revision,to_timestamp(:expires),CAST(:payload AS jsonb)) ON CONFLICT DO NOTHING
            """), {"id": change_id, "operator": operator_id, "feature": feature_id,
                "previous": previous["controlHash"], "current": current["controlHash"],
                "revision": current["revision"], "expires": current["expiresAt"],
                "payload": json.dumps(body, sort_keys=True)})

    async def save_run(self, payload: dict) -> dict:
        async with self.engine.begin() as conn:
            return await save_run_on_connection(conn, payload)

    async def idempotent_run(self, operator_id: str, idempotency_key: str,
                             request_hash: str) -> dict | None:
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT request_hash,payload FROM agent_test_center_runs
                WHERE operator_test_id=:operator AND idempotency_key=:key
            """), {"operator": operator_id, "key": idempotency_key})).first()
            if row and row.request_hash != request_hash:
                raise RuntimeError("Test Center idempotency key conflict")
            return public_run_response(dict(row.payload)) if row else None

    async def get_run(self, run_id: str, operator_id: str) -> dict | None:
        if not re.fullmatch(r"run-[a-f0-9]{32}", run_id):
            raise ValueError("Invalid Test Center run ID")
        async with self.engine.connect() as conn:
            row = (await conn.execute(text(
                "SELECT payload FROM agent_test_center_runs WHERE run_id=:id AND operator_test_id=:operator"
            ), {"id": run_id, "operator": operator_id})).first()
            return public_run_response(dict(row.payload)) if row else None

    async def prerequisite_runs(self, operator_id: str, feature_id: str) -> list[dict]:
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("SELECT payload FROM agent_test_center_runs WHERE operator_test_id=:o AND feature_id=:f ORDER BY run_id DESC LIMIT 20"), {"o": operator_id, "f": feature_id})
            return [public_run_response(dict(row.payload)) for row in rows]

    async def events(self, run_id: str, operator_id: str) -> list[dict]:
        if not re.fullmatch(r"run-[a-f0-9]{32}", run_id):
            raise ValueError("Invalid Test Center run ID")
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("""
                SELECT e.payload FROM agent_test_center_events e
                JOIN agent_test_center_runs r ON r.run_id=e.run_id
                WHERE e.run_id=:id AND r.operator_test_id=:operator ORDER BY e.sequence
            """), {"id": run_id, "operator": operator_id})
            return [dict(row.payload) for row in rows]
