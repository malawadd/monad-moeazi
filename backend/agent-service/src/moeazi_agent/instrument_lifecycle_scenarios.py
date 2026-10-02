"""Adversarial, checked-in local corpus for the instrument lifecycle evaluator."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from importlib.resources import files

from .instrument_lifecycle_contracts import (InstrumentAlias, InstrumentDefinitionVersion,
    NativeInstrumentIdentity, RegistryScope, digest)
from .instrument_lifecycle_evaluator import evaluate
from .instrument_lifecycle_registry import definitions, raw, registry_hash

_CASES = {
    "same-symbol-venues-block": ("propose", "no_identity"),
    "spot-perp-collision-block": ("route", "no_identity"),
    "exact-native-active-allow": ("propose", "normal"),
    "valid-alias-read-allow": ("catalog_display", "alias"),
    "ambiguous-alias-block": ("open", "ambiguous"),
    "expired-alias-block": ("increase", "expired"),
    "paused-new-block": ("prepare", "paused"),
    "halted-reduce-allow": ("reduce", "halted"),
    "settled-settle-allow": ("settle", "settled"),
    "delisted-reconcile-allow": ("reconcile", "delisted"),
    "unknown-new-block": ("open", "unknown"),
    "rebaseline-new-block": ("approve", "rebaseline"),
    "event-gap-block": ("route", "gap"),
    "event-conflict-block": ("propose", "conflict"),
    "history-old-read-allow": ("history_read", "normal"),
    "cross-tenant-alias-block": ("propose", "other_tenant"),
}


def _expectations() -> dict[str, str]:
    value = json.loads(files("moeazi_agent").joinpath(
        "instrument_lifecycle_expectations.json").read_text(encoding="utf-8"))
    if set(value) != {"schemaVersion", "expectations"} or value["schemaVersion"] != 1 \
            or set(value["expectations"]) != set(_CASES):
        raise ValueError("Instrument scenario expectations are not closed")
    return value["expectations"]


def scenario_registry() -> list[dict]:
    return [{"id": key, "operation": value[0]} for key, value in sorted(_CASES.items())]


def _scope(tenant: str = "tenant:fixture") -> RegistryScope:
    return RegistryScope(tenant_id=tenant, venue="hyperliquid", environment="hyperliquid-mainnet", namespace="hl_perp")


def _alias(scope: RegistryScope, definition: InstrumentDefinitionVersion, now: datetime, suffix: str = "") -> InstrumentAlias:
    body = {"scope": scope, "alias": "ETH" + suffix, "target_definition_hash": definition.definition_hash,
        "valid_from": now.replace(year=2025), "valid_until": now.replace(year=2027), "precedence": 10}
    return InstrumentAlias(**body, alias_hash=digest(body))


def _definition(status: str) -> InstrumentDefinitionVersion:
    value = definitions()[0]
    states = {"paused", "halted", "settled", "delisted", "unknown", "rebaseline"}
    if status not in states: return value
    body = value.model_dump(exclude={"definition_hash"}); body["status"] = "rebaseline_required" if status == "rebaseline" else status
    return InstrumentDefinitionVersion(**body, definition_hash=digest(body))


def evaluate_fixture(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str) -> dict:
    operation, fault = _CASES[scenario_id]; expected = _expectations()[scenario_id]; scope = _scope()
    candidate = _definition(fault)
    definition_body = candidate.model_dump(exclude={"definition_hash"})
    definition_body["effective_from"] = now - timedelta(seconds=1)
    definition = InstrumentDefinitionVersion(**definition_body, definition_hash=digest(definition_body))
    all_definitions = [definition]
    identity = NativeInstrumentIdentity.model_validate(raw()["identities"][0])
    aliases: list[InstrumentAlias] = []; events = []
    if fault == "no_identity": identity = None
    elif fault == "alias": identity = None; aliases = [_alias(scope, definition, now)]
    elif fault == "ambiguous": identity = None; aliases = [_alias(scope, definition, now), _alias(scope, definition, now)]
    elif fault == "expired": identity = None; aliases = [_alias(scope, definition, now).model_copy(update={"valid_until": now})]
    elif fault == "other_tenant": identity = None; aliases = [_alias(_scope("tenant:other"), definition, now)]
    if fault in {"gap", "conflict"}:
        from .instrument_lifecycle_contracts import InstrumentLifecycleEvent
        event_body = {"event_id": "fixture:event", "scope": scope, "native_sequence": 2 if fault == "gap" else 1,
            "event_type": "status", "old_definition_hash": definition.definition_hash, "new_definition_hash": definition.definition_hash,
            "effective_at": now, "observed_at": now, "source_evidence_hash": digest({"fixture": scenario_id}), "supersedes_event_hash": None}
        events = [InstrumentLifecycleEvent(**event_body, event_hash=digest(event_body))]
        if fault == "conflict":
            conflict = {**event_body, "new_definition_hash": digest({"conflict": True})}
            events.append(InstrumentLifecycleEvent(**conflict, event_hash=digest(conflict)))
    decision = evaluate(operation, scope, registry_hash(), identity, "ETH" if identity is None else None,
        all_definitions, aliases, events, now, f"instrument:{run_hash[:48]}", digest({"run": run_hash, "scenario": scenario_id}))
    return {"fixtureHash": digest({"scenario": scenario_id, "registry": registry_hash()}), "baselineOutcome": "unavailable",
        "candidateOutcome": decision.outcome, "actualOutcome": decision.outcome, "identityClass": "exact" if identity else "alias_or_missing",
        "definitionVersion": definition.version, "lifecycleState": definition.status, "aliasResolution": "resolved" if aliases and not decision.reasons else "not_used_or_blocked",
        "eventWatermark": decision.event_watermark, "invalidationTotals": 0 if decision.outcome == "allow" else 5,
        "permittedLanes": decision.permitted_lanes, "decisionHash": decision.decision_hash, "registryHash": registry_hash(),
        "productOutcome": "unavailable", "reasons": decision.reasons, "invariantVerdict": "pass" if decision.outcome == expected else "fail"}
