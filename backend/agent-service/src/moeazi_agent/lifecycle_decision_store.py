"""Persist nonauthorizing decisions against current scoped replay checkpoints."""
from __future__ import annotations

import json

from sqlalchemy import text

from .account_observation_storage import account_snapshot_hash
from .finance_contracts import FinanceError, FinanceScope, _hash
from .finance_observation_contracts import account_snapshot_from_row
from .lifecycle_dataset import load_dataset
from .lifecycle_decision import ReplayDecisionContext, build_replay_decision
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .observation_contracts import EvidenceSnapshot


class LifecycleDecisionStoreMixin:
    async def register_replay_decision(
        self, scope: FinanceScope, run_id: str, manifest_hash: str,
        instrument_version_id: str, evidence_snapshot_hash: str,
    ) -> ReplayDecisionContext:
        """Caller selects stored evidence, never a cursor, balance or price.

        This immutable research identity is not an order permit. Admission must
        separately recheck the current financial checkpoint and product authority.
        """
        _hash(manifest_hash)
        _hash(evidence_snapshot_hash)
        if scope.environment != "experiment" or not run_id or not instrument_version_id:
            raise FinanceError("Replay decision needs a scoped experimental run")
        params = _run_params(scope, run_id)
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            if run["manifest_hash"] != manifest_hash:
                raise FinanceError("Replay decision manifest differs")
            manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
            if manifest.scope != scope or manifest.run_id != run_id or \
                    manifest.manifest_hash != manifest_hash:
                raise FinanceError("Stored replay manifest crosses its requested scope")
            if account["reconciliation_state"] != "clean" or \
                    account["policy_version"] != manifest.policy_version or \
                    account["policy_hash"] != manifest.policy_hash or \
                    account["observation_snapshot_hash"] is None:
                raise FinanceError("Replay decision lacks a clean current financial checkpoint")
            snapshot_row = (await conn.execute(text("""
                SELECT * FROM observation_account_snapshots
                WHERE snapshot_hash=:hash AND environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), {**params, "hash": account["observation_snapshot_hash"]})).mappings().first()
            if snapshot_row is None:
                raise FinanceError("Replay decision account observation is unavailable")
            snapshot = account_snapshot_from_row(snapshot_row)
            if snapshot.scope != scope or account_snapshot_hash(snapshot) != snapshot.snapshot_hash or \
                    snapshot.status != "accepted" or snapshot.has_gap or snapshot.has_reorg or \
                    not snapshot.balances_complete or not snapshot.positions_complete or \
                    snapshot.finality != "admitted_final" or snapshot.finality_at is None or \
                    snapshot.cutoff_at > run["replay_cursor_at"]:
                raise FinanceError("Replay decision account observation is invalid or arrives later")
            evidence_row = (await conn.execute(text("""
                SELECT cutoff_at,instrument_version_ids,accepted_observation_hashes,
                  excluded,source_rights_refs,has_gap FROM observation_evidence_snapshots
                WHERE snapshot_hash=:hash
            """), {"hash": evidence_snapshot_hash})).mappings().first()
            if evidence_row is None:
                raise FinanceError("Replay decision market evidence is unavailable")
            evidence = EvidenceSnapshot(schema_version=1,
                cutoff_at=evidence_row["cutoff_at"],
                instrument_version_ids=tuple(evidence_row["instrument_version_ids"]),
                accepted_observation_hashes=tuple(evidence_row["accepted_observation_hashes"]),
                excluded=tuple(evidence_row["excluded"]),
                source_rights_refs=tuple(evidence_row["source_rights_refs"]),
                has_gap=evidence_row["has_gap"], snapshot_hash=evidence_snapshot_hash)
            dataset = await load_dataset(conn, manifest)
            decision, _ = build_replay_decision(manifest, dataset,
                run["replay_cursor_at"], evidence,
                instrument_version_id=instrument_version_id,
                account_snapshot_hash=snapshot.snapshot_hash)
            values = {**params, "hash": decision.decision_hash}
            previous = (await conn.execute(text("""
                SELECT decision_json FROM simulation_decision_contexts
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND decision_hash=:hash
            """), values)).scalar_one_or_none()
            body = decision.model_dump(mode="json")
            if previous is not None:
                if previous != body or ReplayDecisionContext.model_validate_json(
                        json.dumps(previous)) != decision:
                    raise FinanceError("Stored replay decision identity conflicts")
                return decision
            await conn.execute(text("""
                INSERT INTO simulation_decision_contexts(environment,scope_id,
                  strategy_account_id,run_id,decision_hash,decision_json,
                  instrument_version_id,cursor_at,evidence_cutoff_at,
                  evidence_snapshot_hash,account_snapshot_hash,dataset_prefix_count)
                VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:hash,
                  CAST(:body AS jsonb),:instrument,:cursor,:cutoff,:evidence,:account,:prefix)
            """), {**values, "body": json.dumps(body, sort_keys=True,
                separators=(",", ":"), ensure_ascii=False),
                "instrument": decision.instrument_version_id, "cursor": decision.cursor_at,
                "cutoff": decision.evidence_cutoff_at, "evidence": evidence_snapshot_hash,
                "account": snapshot.snapshot_hash, "prefix": decision.dataset_prefix_count})
            return decision
