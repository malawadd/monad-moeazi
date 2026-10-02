"""Pure operation matrix for the local synthetic instrument registry."""
from __future__ import annotations

from datetime import datetime, timedelta

from .instrument_lifecycle_contracts import (InstrumentAlias, InstrumentDefinitionVersion,
    InstrumentLifecycleEvent, InstrumentOperationDecision, NativeInstrumentIdentity,
    RegistryScope, digest)
from .instrument_lifecycle_events import fold
from .instrument_lifecycle_registry import operation_lanes

NEW = {"propose", "approve", "route", "risk", "prepare", "open", "increase"}
SAFE = {"cancel", "reduce", "settle", "reconcile"}


def resolve(identity: NativeInstrumentIdentity | None, alias: str | None, scope: RegistryScope,
            definitions: list[InstrumentDefinitionVersion], aliases: list[InstrumentAlias], now: datetime) -> tuple[InstrumentDefinitionVersion | None, list[str]]:
    if identity:
        if (identity.venue != scope.venue or identity.environment != scope.environment
                or identity.namespace != scope.namespace):
            return None, ["identity_scope_mismatch"]
        found = [item for item in definitions if item.identity_hash == identity.identity_hash
                 and item.kind == identity.kind and item.effective_from <= now
                 and (item.effective_until is None or now < item.effective_until)]
        return (found[0], []) if len(found) == 1 else (None, ["identity_ambiguous_or_unknown"])
    if not alias: return None, ["exact_identity_required"]
    candidates = [item for item in aliases if item.alias == alias and item.scope == scope and item.valid_from <= now < item.valid_until]
    if not candidates: return None, ["alias_unavailable"]
    best = max(item.precedence for item in candidates); candidates = [item for item in candidates if item.precedence == best]
    if len(candidates) != 1: return None, ["alias_ambiguous"]
    matched = [item for item in definitions if item.definition_hash == candidates[0].target_definition_hash
               and item.effective_from <= now and (item.effective_until is None or now < item.effective_until)]
    return (matched[0], []) if len(matched) == 1 else (None, ["alias_target_unknown"])


def evaluate(operation: str, scope: RegistryScope, snapshot_hash: str,
             identity: NativeInstrumentIdentity | None, alias: str | None,
             definitions: list[InstrumentDefinitionVersion], aliases: list[InstrumentAlias],
             events: list[InstrumentLifecycleEvent], now: datetime, key: str,
             request_hash: str, rebaseline_complete: bool = False) -> InstrumentOperationDecision:
    definition, reasons = resolve(identity, alias, scope, definitions, aliases, now)
    scoped_events = [item for item in events if item.scope == scope]
    if len(scoped_events) != len(events): reasons.append("event_scope_mismatch")
    _, fold_reasons, watermark = fold(scoped_events); reasons.extend(fold_reasons)
    known_definitions = {item.definition_hash: item for item in definitions}
    for event in scoped_events:
        if event.old_definition_hash and event.old_definition_hash not in known_definitions:
            reasons.append("event_old_definition_unknown")
        if event.new_definition_hash and event.new_definition_hash not in known_definitions:
            reasons.append("event_new_definition_unknown")
    current_events = [item for item in scoped_events if item.effective_at <= now and item.new_definition_hash]
    if definition and current_events:
        latest = max(current_events, key=lambda item: (item.native_sequence, item.effective_at, item.event_hash))
        if latest.old_definition_hash == definition.definition_hash:
            definition = known_definitions.get(latest.new_definition_hash, definition)
        else:
            reasons.append("event_definition_discontinuity")
    status = definition.status if definition else "unknown"
    lanes = operation_lanes(status); safe = sorted(lanes.get("safe", []))
    if status == "rebaseline_required" and not rebaseline_complete: reasons.append("rebaseline_required")
    if operation in NEW:
        if reasons or operation not in lanes.get("new", []):
            if not reasons: reasons.append(f"state_{status}")
            outcome = "block"
        else: outcome = "allow"
    elif operation in SAFE:
        if definition and operation in safe and not reasons: outcome = "allow"
        elif not definition or reasons: outcome = "unknown"
        else: outcome = "safe_only" if safe else "block"
    elif operation in {"catalog_display", "analyze", "history_read"}:
        outcome = "allow" if definition and not reasons else "unknown"
    else:
        reasons.append("operation_unsupported"); outcome = "block"
    canonical_snapshot = digest({"scope": scope, "definitions": sorted(item.definition_hash for item in definitions),
        "aliases": sorted(item.alias_hash for item in aliases), "events": sorted(item.event_hash for item in scoped_events)})
    canonical_request = digest({"operation": operation, "scope": scope,
        "identity": identity.identity_hash if identity else None, "alias": alias,
        "snapshot": canonical_snapshot, "rebaselineComplete": rebaseline_complete, "key": key})
    body = {"operation": operation, "scope": scope, "stable_id": definition.stable_id if definition else None,
        "definition_hash": definition.definition_hash if definition else None, "snapshot_hash": snapshot_hash,
        "event_watermark": watermark, "outcome": outcome, "reasons": sorted(set(reasons)),
        "permitted_lanes": safe if definition and not reasons else [], "expires_at": now + timedelta(minutes=5), "idempotency_key": key,
        "request_hash": request_hash}
    body["snapshot_hash"] = canonical_snapshot
    body["request_hash"] = canonical_request
    return InstrumentOperationDecision(**body, decision_hash=digest(body))
