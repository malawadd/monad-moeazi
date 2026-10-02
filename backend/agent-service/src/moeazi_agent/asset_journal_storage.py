"""Atomic append-only persistence for frozen Asset Conservation Journal bundles."""
from __future__ import annotations
import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from .asset_journal_canonical import digest
from .asset_journal_contracts import AssetUnit, ConservationCheck, JournalAccount, JournalManifest, JournalReceipt, PostingCandidate, SourceEvent
from .test_center_storage import save_run_on_connection

class AssetJournalRepository:
    def __init__(self, engine: AsyncEngine): self.engine = engine

    async def persist_bundle(self, units: list[AssetUnit], accounts: list[JournalAccount], events: list[SourceEvent], manifest: JournalManifest,
                             candidates: list[PostingCandidate], check: ConservationCheck, journal_receipt: JournalReceipt, payload: dict) -> dict:
        if check.check_hash != journal_receipt.check_hash or manifest.manifest_hash != journal_receipt.manifest_hash: raise RuntimeError("journal bundle binding failed")
        async with self.engine.begin() as conn:
            await conn.execute(text("SELECT pg_advisory_xact_lock(hashtext(:lock))"), {"lock": f"{manifest.scope.scope_hash}:{manifest.idempotency_key}"})
            prior = (await conn.execute(text("SELECT request_hash,payload FROM journal_commit_receipts WHERE scope_hash=:scope AND idempotency_key=:key"), {"scope": manifest.scope.scope_hash, "key": manifest.idempotency_key})).first()
            if prior:
                if prior.request_hash != manifest.request_hash: raise RuntimeError("journal idempotency conflict")
                return dict(prior.payload).get("run", payload)
            async def insert(table: str, key: str, value, extra: dict):
                await conn.execute(text(f"INSERT INTO {table} ({key},scope_hash,payload) VALUES (:hash,:scope,CAST(:payload AS jsonb))"),
                    {"hash": getattr(value, key), "scope": manifest.scope.scope_hash, "payload": json.dumps(value.model_dump(mode='json'), sort_keys=True), **extra})
            for unit in units:
                await conn.execute(text("INSERT INTO journal_asset_units (unit_hash,scope_hash,payload) VALUES (:hash,:scope,CAST(:payload AS jsonb))"), {"hash": unit.unit_hash, "scope": manifest.scope.scope_hash, "payload": json.dumps(unit.model_dump(mode='json'), sort_keys=True)})
            for account in accounts:
                await conn.execute(text("INSERT INTO journal_accounts (account_hash,scope_hash,unit_hash,payload) VALUES (:hash,:scope,:unit,CAST(:payload AS jsonb))"), {"hash": account.account_hash, "scope": manifest.scope.scope_hash, "unit": account.unit_hash, "payload": json.dumps(account.model_dump(mode='json'), sort_keys=True)})
            for event in {event.event_hash: event for event in events}.values():
                await conn.execute(text("INSERT INTO journal_source_events (event_hash,scope_hash,source_owner,source_stream,event_id,revision,payload) VALUES (:hash,:scope,:owner,:stream,:event,:revision,CAST(:payload AS jsonb))"), {"hash": event.event_hash, "scope": manifest.scope.scope_hash, "owner": event.source_owner, "stream": event.source_stream, "event": event.event_id, "revision": event.revision, "payload": json.dumps(event.model_dump(mode='json'), sort_keys=True)})
            await conn.execute(text("INSERT INTO journal_input_manifests (manifest_hash,scope_hash,idempotency_key,request_hash,payload) VALUES (:hash,:scope,:key,:request,CAST(:payload AS jsonb))"), {"hash": manifest.manifest_hash, "scope": manifest.scope.scope_hash, "key": manifest.idempotency_key, "request": manifest.request_hash, "payload": json.dumps(manifest.model_dump(mode='json'), sort_keys=True)})
            await conn.execute(text("INSERT INTO journal_conservation_checks (check_hash,scope_hash,manifest_hash,payload) VALUES (:hash,:scope,:manifest,CAST(:payload AS jsonb))"), {"hash": check.check_hash, "scope": manifest.scope.scope_hash, "manifest": manifest.manifest_hash, "payload": json.dumps(check.model_dump(mode='json'), sort_keys=True)})
            run = await save_run_on_connection(conn, payload)
            receipt_payload = {**journal_receipt.model_dump(mode="json"), "run": run}
            await conn.execute(text("INSERT INTO journal_commit_receipts (receipt_hash,scope_hash,idempotency_key,request_hash,manifest_hash,payload) VALUES (:hash,:scope,:key,:request,:manifest,CAST(:payload AS jsonb))"), {"hash": journal_receipt.receipt_hash, "scope": manifest.scope.scope_hash, "key": manifest.idempotency_key, "request": manifest.request_hash, "manifest": manifest.manifest_hash, "payload": json.dumps(receipt_payload, sort_keys=True)})
            await conn.execute(text("INSERT INTO journal_test_center_bundles (run_id,manifest_hash,check_hash,receipt_hash) VALUES (:run,:manifest,:check,:receipt)"), {"run": run["runId"], "manifest": manifest.manifest_hash, "check": check.check_hash, "receipt": journal_receipt.receipt_hash})
            return run
