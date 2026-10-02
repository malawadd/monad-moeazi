"""Deterministic intent identity from a server-calculated replay risk receipt."""
from __future__ import annotations

from datetime import timedelta
from hashlib import sha256

from .finance_contracts import FinanceError, _digest
from .lifecycle_contracts import ProtectionRequirement, TradeIntent
from .lifecycle_decision import ReplayDecisionContext
from .lifecycle_replay_finance_contracts import ReplaySizingReceipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_strategy import ReplayStrategyDraft


def replay_intent_id(manifest: SimulationRunManifest, request_id: str) -> str:
    if not request_id:
        raise FinanceError("replay intent requires a durable request")
    return sha256(("moeazi-replay-intent-v1:" + manifest.scope.environment + ":" +
        manifest.scope.scope_id + ":" + manifest.scope.strategy_account_id + ":" +
        manifest.run_id + ":" + request_id).encode("utf-8")).hexdigest()


def build_replay_intent(manifest: SimulationRunManifest,
                        decision: ReplayDecisionContext,
                        draft: ReplayStrategyDraft,
                        receipt: ReplaySizingReceipt,
                        request_id: str) -> TradeIntent:
    if receipt.request_id != request_id or receipt.run_id != manifest.run_id or \
            receipt.manifest_hash != manifest.manifest_hash or \
            receipt.decision_hash != decision.decision_hash or \
            receipt.evidence_snapshot_hash != draft.evidence_snapshot_hash or \
            receipt.action != draft.action or receipt.side != draft.side or \
            receipt.desired_quantity_units != draft.desired_quantity_units or \
            receipt.instrument_version_id != draft.instrument_version_id or \
            decision.cursor_at != receipt.replay_cursor_at:
        raise FinanceError("replay intent differs from calculated entry")
    expires = min(decision.cursor_at + timedelta(seconds=draft.horizon_seconds),
                  manifest.scenario.simulation_end_at)
    if expires <= decision.cursor_at:
        raise FinanceError("replay intent has no future validity window")
    increasing = draft.action in {"spot_buy", "perp_open", "perp_increase"}
    unprotected_seconds = draft.horizon_seconds
    if increasing and manifest.protection_policy is not None:
        unprotected_seconds = manifest.protection_policy.maximum_unprotected_seconds
        if decision.cursor_at + timedelta(seconds=unprotected_seconds) > \
                manifest.scenario.simulation_end_at:
            raise FinanceError("historical protection deadline exceeds replay end")
    protection = ProtectionRequirement(required=increasing,
        policy_version=manifest.policy_version, policy_hash=manifest.policy_hash,
        maximum_unprotected_seconds=unprotected_seconds,
        on_rejection="hold_and_escalate")
    body = dict(schema_version=1, scope=manifest.scope,
        controller_ref=manifest.controller_ref,
        controller_mode=manifest.controller_mode, run_id=manifest.run_id,
        run_manifest_hash=manifest.manifest_hash,
        intent_id=replay_intent_id(manifest, request_id),
        strategy_artifact_hash=manifest.strategy_artifact_hash,
        instrument_version_id=receipt.instrument_version_id,
        instrument_registry_hash=receipt.instrument_registry_hash,
        action=draft.action, side=draft.side,
        target_exposure_units=receipt.target_exposure_units,
        desired_quantity_units=draft.desired_quantity_units,
        horizon_seconds=draft.horizon_seconds,
        evidence_snapshot_hash=decision.evidence_snapshot_hash,
        decision_context_hash=decision.decision_hash,
        calculation_receipt_hash=receipt.receipt_hash,
        supplied_claim_ids=(), verified_claim_receipt_hashes=(),
        rationale_summary=draft.rationale_summary,
        invalidation_rule_hash=draft.rule_hash,
        expires_at_cursor=expires, protection=protection)
    encoded = TradeIntent.model_construct(**body).model_dump(
        mode="json", exclude={"intent_hash"})
    return TradeIntent.model_validate({**body,
        "intent_hash": _digest("moeazi-trade-intent-v1", encoded)})
