"""Atomic immutable Timescale bundle persistence for local Feature 09 fixtures."""
from __future__ import annotations

import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .risk_reconciliation_contracts import (ExecutionAttemptReceipt, ReconciliationReceipt,
    RiskInputManifest, RiskObservation, RiskReservation, RiskSnapshot)
from .test_center_storage import save_run_on_connection


def _same_payload(stored, value: dict) -> bool:
    return (json.loads(stored) if isinstance(stored, str) else stored) == value


async def _verify_payload(conn, table: str, key: str, value: str, payload: dict) -> None:
    """Read back immutable appends, including exact retries, before committing."""
    prior = (await conn.execute(text(f"SELECT payload FROM {table} WHERE {key}=:value"), {"value": value})).first()
    if not prior or not _same_payload(prior.payload, payload):
        raise RuntimeError(f"risk {table} append conflict")


class RiskReconciliationRepository:
    def __init__(self, engine: AsyncEngine): self.engine = engine

    async def persist_bundle(self, observations: list[RiskObservation], manifest: RiskInputManifest,
                             snapshot: RiskSnapshot, reservation: RiskReservation,
                             attempt: ExecutionAttemptReceipt | None, reconciliation: ReconciliationReceipt | None,
                             run_payload: dict) -> dict:
        if snapshot.manifest_hash != manifest.manifest_hash or reservation.snapshot_hash != snapshot.snapshot_hash:
            raise RuntimeError("risk bundle hash binding failed")
        scope = manifest.scope
        async with self.engine.begin() as conn:
            for item in observations:
                payload = item.model_dump(mode="json")
                await conn.execute(text("""INSERT INTO risk_source_observations (observation_hash,tenant_id,account_id,scope_key,source_id,payload)
                    VALUES (:hash,:tenant,:account,:scope,:source,CAST(:payload AS jsonb)) ON CONFLICT DO NOTHING"""),
                    {"hash": item.observation_hash, "tenant": scope.tenant_id, "account": scope.account_id, "scope": scope.scope_key,
                     "source": item.source_id, "payload": json.dumps(payload, sort_keys=True)})
                await _verify_payload(conn, "risk_source_observations", "observation_hash", item.observation_hash, payload)
            for table, key, body in (("risk_input_manifests", "manifest_hash", manifest), ("risk_snapshots", "snapshot_hash", snapshot),
                                     ("risk_reservations", "reservation_hash", reservation)):
                payload = body.model_dump(mode="json")
                await conn.execute(text(f"INSERT INTO {table} ({key},tenant_id,account_id,scope_key,payload) VALUES (:hash,:tenant,:account,:scope,CAST(:payload AS jsonb)) ON CONFLICT DO NOTHING"),
                    {"hash": getattr(body, key), "tenant": scope.tenant_id, "account": scope.account_id, "scope": scope.scope_key,
                     "payload": json.dumps(payload, sort_keys=True)})
                await _verify_payload(conn, table, key, getattr(body, key), payload)
            for table, body in (("risk_execution_attempts", attempt), ("risk_reconciliation_receipts", reconciliation)):
                if body:
                    key = "receipt_hash"
                    payload = body.model_dump(mode="json")
                    await conn.execute(text(f"INSERT INTO {table} ({key},tenant_id,account_id,scope_key,payload) VALUES (:hash,:tenant,:account,:scope,CAST(:payload AS jsonb)) ON CONFLICT DO NOTHING"),
                        {"hash": body.receipt_hash, "tenant": scope.tenant_id, "account": scope.account_id, "scope": scope.scope_key,
                         "payload": json.dumps(payload, sort_keys=True)})
                    await _verify_payload(conn, table, key, body.receipt_hash, payload)
            run = await save_run_on_connection(conn, run_payload)
            await conn.execute(text("""INSERT INTO risk_test_center_bundles (run_id,manifest_hash,snapshot_hash,reservation_hash)
                VALUES (:run,:manifest,:snapshot,:reservation) ON CONFLICT DO NOTHING"""),
                {"run": run["runId"], "manifest": manifest.manifest_hash, "snapshot": snapshot.snapshot_hash, "reservation": reservation.reservation_hash})
            bound = (await conn.execute(text("SELECT manifest_hash,snapshot_hash,reservation_hash FROM risk_test_center_bundles WHERE run_id=:run"),
                {"run": run["runId"]})).first()
            if not bound or tuple(bound) != (manifest.manifest_hash, snapshot.snapshot_hash, reservation.reservation_hash):
                raise RuntimeError("risk Test Center bundle conflict")
            return run

    @staticmethod
    def reconstruct_reservations(rows: list[RiskReservation]) -> dict[str, RiskReservation]:
        """Rebuild nonterminal capacity holds from immutable fixture rows only."""
        held = {"requested", "reserved", "reconciliation_hold"}
        result: dict[str, RiskReservation] = {}
        for row in rows:
            prior = result.get(row.reservation_id)
            if prior and prior.reservation_hash != row.reservation_hash:
                raise RuntimeError("risk reservation reconstruction conflict")
            if row.state in held: result[row.reservation_id] = row
            elif row.state in {"consumed", "released", "expired", "conflict"}: result.pop(row.reservation_id, None)
        return result
