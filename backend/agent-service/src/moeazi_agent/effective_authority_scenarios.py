"""Closed declarative scenarios for the non-authorizing local projector."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from importlib.resources import files

from .effective_authority_canonical import digest, json_loads_strict
from .effective_authority_gate_contracts import GateResult, SourceReceiptReference
from .effective_authority_persistence_graph import build_persistence_graph
from .effective_authority_reducer import reduce
from .effective_authority_registry import gate as definition, required_gate_ids
from .effective_authority_scope_contracts import AuthorityScope, BoundaryIdentity, ProjectionRequest

NOW = datetime(2026, 8, 5, tzinfo=timezone.utc)
_SCENARIO_KEYS = {"id", "mode", "approval", "boundary", "action", "removeGate", "mutateGate", "mutateStatus", "clockDeltaSeconds", "chainFault", "wrongScope", "wrongSourceVersion", "unknownGate"}


def _hash(value: object) -> str:
    return digest(value)


def scenario_registry() -> list[dict]:
    rows = json_loads_strict(files("moeazi_agent").joinpath("effective_authority_scenarios.json").read_text())["scenarios"]
    known = set(required_gate_ids())
    if len(rows) != 26 or len({row["id"] for row in rows}) != 26 or any(set(row) != _SCENARIO_KEYS or row["removeGate"] not in known | {None} or row["mutateGate"] not in known | {None} for row in rows):
        raise ValueError("effective_authority_scenario_registry_invalid")
    return rows


def _scope(suffix: str = "fixture") -> AuthorityScope:
    body = {"tenant_fingerprint": f"tenant:{suffix}", "account_fingerprint": f"account:{suffix}", "strategy_fingerprint": f"strategy:{suffix}", "chain_id": 42161}
    return AuthorityScope(**body, scope_hash=_hash(body))


def _request(row: dict | bool | None = None) -> ProjectionRequest:
    row = {"boundary": "preflight", "action": "preflight", "approval": bool(row)} if not isinstance(row, dict) else row
    boundary = BoundaryIdentity(boundary=row["boundary"], action=row["action"], approval_hash=_hash("approval") if row["approval"] else None)
    return ProjectionRequest(scope=_scope(), boundary=boundary, analysis_hash=_hash("analysis"), idempotency_hash=_hash("idem"), request_hash=_hash("request"))


def _gate(gate_id: str, request: ProjectionRequest, index: int, status: str = "pass", *, scope: AuthorityScope | None = None, source_version: str = "fixture-v1", provenance: str = "local_fixture_untrusted", predecessor_hash: str | None = None, receipt_salt: str = "receipt") -> GateResult:
    definition_row = definition(gate_id)
    source = SourceReceiptReference(source_type=definition_row["sourceType"] if definition_row else "fixture", source_version=source_version, receipt_hash=_hash([gate_id, receipt_salt, index]), revision=1, provenance=provenance)
    body = {"gate_id": gate_id, "scope": scope or request.scope, "boundary": request.boundary, "status": status, "ceiling": "PREFLIGHT_ONLY", "reason_code": "FIXTURE_UNTRUSTED", "remediation_code": "REVIEW_FIXTURE", "observed_at": NOW, "expires_at": NOW + timedelta(minutes=5), "source": source, "sequence": index, "predecessor_hash": predecessor_hash}
    return GateResult(**body, result_hash=_hash({**body, "registry_version": "effective-authority-v1"}))


def _replace_gate(gates: list[GateResult], replacement: GateResult) -> None:
    gates[:] = [gate for gate in gates if gate.gate_id != replacement.gate_id]
    gates.append(replacement)


def _chain_mutation(gates: list[GateResult], request: ProjectionRequest, gate_id: str, fault: str) -> None:
    base = next(gate for gate in gates if gate.gate_id == gate_id)
    if fault == "fork":
        gates.append(_gate(gate_id, request, base.sequence, base.status, receipt_salt="fork"))
    elif fault == "gap":
        _replace_gate(gates, _gate(gate_id, request, 3, base.status, predecessor_hash=base.result_hash, receipt_salt="gap"))
        gates.append(_gate(gate_id, request, 1, base.status, receipt_salt="gap-root"))
    elif fault == "rollback":
        _replace_gate(gates, _gate(gate_id, request, 2, base.status, predecessor_hash=_hash("missing-predecessor"), receipt_salt="rollback"))
        gates.append(base)
    else:
        raise ValueError("unknown_declared_chain_fault")


def _mutation_label(row: dict) -> str:
    parts = []
    if row["removeGate"]: parts.append(f"remove:{row['removeGate']}")
    if row["mutateGate"]: parts.append(f"status:{row['mutateGate']}:{row['mutateStatus']}")
    if row["clockDeltaSeconds"]: parts.append(f"clock:+{row['clockDeltaSeconds']}s")
    if row["chainFault"]: parts.append(f"chain:{row['chainFault']}:{row['mutateGate']}")
    if row["wrongScope"]: parts.append(f"scope:{row['mutateGate']}")
    if row["wrongSourceVersion"]: parts.append(f"source-version:{row['mutateGate']}")
    if row["unknownGate"]: parts.append("unknown-gate:unknown_gate")
    return "|".join(parts) if parts else "none"


def evaluate_fixture(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str) -> dict:
    row = next((item for item in scenario_registry() if item["id"] == scenario_id), None)
    if row is None: raise ValueError("Unknown checked-in effective authority scenario")
    request = _request(row)
    gates = [_gate(gate_id, request, 1, row["mutateStatus"] if gate_id == row["mutateGate"] else "pass") for gate_id in required_gate_ids() if gate_id != row["removeGate"]]
    target = row["mutateGate"]
    if target and row["wrongScope"]: _replace_gate(gates, _gate(target, request, 1, row["mutateStatus"] or "pass", scope=_scope("other")))
    if target and row["wrongSourceVersion"]: _replace_gate(gates, _gate(target, request, 1, row["mutateStatus"] or "pass", source_version="fixture-v0"))
    if target and row["chainFault"]: _chain_mutation(gates, request, target, row["chainFault"])
    if row["unknownGate"]: gates.append(_gate("unknown_gate", request, 1, receipt_salt="unknown"))
    decision = reduce(request, tuple(gates), row["mode"], now + timedelta(seconds=row["clockDeltaSeconds"]))
    graph = build_persistence_graph(request, tuple(gates), decision, run_hash)
    statuses = {status: sum(gate.status == status for gate in gates) for status in ("pass", "fail", "unknown", "stale", "not_applicable")}
    return {"scenarioId": scenario_id, "mutationObserved": _mutation_label(row), "fixtureHash": _hash({"id": scenario_id, "run": run_hash}), "selectedMode": row["mode"], "effectiveCapability": decision.capability, "phase": decision.phase, "coverage": decision.coverage, "reasonCodes": [reason.reason_code for reason in decision.reasons], "remediationCodes": [reason.remediation_code for reason in decision.reasons], "gateStatusCounts": statuses, "decisionHash": decision.decision_hash, "registryHash": decision.registry_hash, "productOutcome": "unavailable", "authorityEffect": "none", "nonAuthorizing": True, "externalAttempts": 0, "providerCost": 0, "invariantVerdict": "pass" if decision.capability != "SUBMISSION_ELIGIBLE" else "fail", "_artifacts": {"request": request, "gates": tuple(gates), "decision": decision, "graph": graph}}
