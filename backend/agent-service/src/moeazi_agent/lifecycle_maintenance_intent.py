"""Owner-close intent provenance, separate from nonauthorizing strategy drafts."""
from __future__ import annotations

from datetime import timedelta

from .finance_contracts import FinanceError, _digest, _hash
from .lifecycle_contracts import ProtectionRequirement, TradeIntent
from .lifecycle_decision import ReplayDecisionContext
from .lifecycle_replay_finance_contracts import ReplaySizingReceipt
from .lifecycle_replay_intent import replay_intent_id
from .lifecycle_run_contracts import SimulationRunManifest


def build_maintenance_intent(manifest: SimulationRunManifest,
                             decision: ReplayDecisionContext,
                             receipt: ReplaySizingReceipt,
                             command_hash: str) -> TradeIntent:
    """A persisted authenticated close, not a strategy rule, supplies authority."""
    _hash(command_hash)
    if receipt.code_version != "replay-sizing-v2" or \
            receipt.execution_envelope is None or \
            receipt.scope != manifest.scope or \
            receipt.manifest_hash != manifest.manifest_hash or \
            receipt.run_id != manifest.run_id or \
            receipt.request_id != "maintenance:" + command_hash or \
            receipt.action not in {"spot_sell", "perp_reduce", "perp_close"} or \
            receipt.decision_hash != decision.decision_hash or \
            receipt.evidence_snapshot_hash != decision.evidence_snapshot_hash or \
            receipt.replay_cursor_at != decision.cursor_at:
        raise FinanceError("owner close differs from current replay calculation")
    expires = min(decision.cursor_at + timedelta(seconds=30),
                  manifest.scenario.simulation_end_at)
    if expires <= decision.cursor_at:
        raise FinanceError("owner close has no replay dispatch window")
    protection = ProtectionRequirement(required=False,
        policy_version=manifest.policy_version, policy_hash=manifest.policy_hash,
        maximum_unprotected_seconds=0, on_rejection="hold_and_escalate")
    body = dict(schema_version=1, scope=manifest.scope,
        controller_ref=manifest.controller_ref,
        controller_mode=manifest.controller_mode, run_id=manifest.run_id,
        run_manifest_hash=manifest.manifest_hash,
        intent_id=replay_intent_id(manifest, receipt.request_id),
        strategy_artifact_hash=manifest.strategy_artifact_hash,
        instrument_version_id=receipt.instrument_version_id,
        instrument_registry_hash=receipt.instrument_registry_hash,
        action=receipt.action, side=receipt.side,
        target_exposure_units=receipt.target_exposure_units,
        desired_quantity_units=receipt.desired_quantity_units,
        horizon_seconds=max(1, int((expires-decision.cursor_at).total_seconds())),
        evidence_snapshot_hash=decision.evidence_snapshot_hash,
        decision_context_hash=decision.decision_hash,
        calculation_receipt_hash=receipt.receipt_hash,
        supplied_claim_ids=(), verified_claim_receipt_hashes=(),
        rationale_summary="Owner-requested simulated reduce-only close",
        invalidation_rule_hash=command_hash,
        expires_at_cursor=expires, protection=protection,
        maintenance_command_hash=command_hash)
    encoded = TradeIntent.model_construct(**body).model_dump(
        mode="json", exclude={"intent_hash"})
    return TradeIntent.model_validate({**body,
        "intent_hash": _digest("moeazi-trade-intent-v1", encoded)})
