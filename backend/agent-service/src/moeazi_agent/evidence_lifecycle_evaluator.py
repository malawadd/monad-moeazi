from __future__ import annotations

import re
import math
import json
import unicodedata
from datetime import datetime, timedelta
from hashlib import sha256
from typing import Any

from .dependency_safety_contracts import canonical_json, canonical_request_value
from .evidence_lifecycle_contracts import (
    DataElementClass, LifecycleScope, PersistenceDecision, RetentionSchedule,
    TransformReceipt,
)
from .evidence_lifecycle_registry import (
    DECISION_TTL_SECONDS, MANDATORY_SAFETY_PATHS, MAX_DEPTH, MAX_FIELDS,
    MAX_STRING_BYTES, PROCESSOR_VERSION, policy_for,
)
from .contracts import AgentRunView, MarketSynthesis, SignalReport

SECRET_NAMES = frozenset({"authorization", "password", "secret", "private_key", "seed",
    "mnemonic", "byok", "api_key", "credential", "credentials", "wallet_key"})
SAFE_SECRET_LABELS = frozenset({"credential_source", "credential_sources"})
SECRET_VALUE = re.compile(
    r"(?:sk-[A-Za-z0-9_-]{16,}|0x[a-fA-F0-9]{64}|"
    r"(?:api[\s_-]*key|authorization(?:[\s_-]*token)?|password|private[\s_-]*key|wallet[\s_-]*key|"
    r"seed|mnemonic|byok|credential)s?[\"']?\s*[:=]\s*[\"']?\S+)", re.I)
ESCAPE = re.compile(r"\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|x([0-9a-fA-F]{2}))")


def _digest(value: Any) -> str:
    return sha256(canonical_json(canonical_request_value(value))).hexdigest()


def _id(prefix: str, value: Any) -> str:
    return f"{prefix}_{_digest(value)[:48]}"


def _key(value: str) -> str:
    value = _security_text(value)
    return re.sub(r"[^a-z0-9]+", "_", re.sub(r"(?<!^)(?=[A-Z])", "_", value).lower()).strip("_")


def _security_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = "".join(char for char in value if unicodedata.category(char) != "Cf")
    def decode(match):
        token = next(item for item in match.groups() if item is not None)
        point = int(token, 16)
        return chr(point) if point <= 0x10FFFF else ""
    value = unicodedata.normalize("NFKC", ESCAPE.sub(decode, value))
    return "".join(char for char in value if unicodedata.category(char) != "Cf")


def _validate_shape(payload: Any, depth: int = 0, count: list[int] | None = None,
        max_depth: int = MAX_DEPTH, max_fields: int = MAX_FIELDS) -> None:
    count = count or [0]
    if depth > max_depth: raise ValueError("payload_depth_exceeded")
    if isinstance(payload, dict):
        count[0] += len(payload)
        if count[0] > max_fields: raise ValueError("payload_field_count_exceeded")
        for key, value in payload.items():
            if not isinstance(key, str): raise ValueError("payload_key_invalid")
            normalized = _key(key)
            if normalized not in SAFE_SECRET_LABELS and any(
                    normalized == name or normalized.startswith(f"{name}_")
                    or normalized.endswith(f"_{name}") for name in SECRET_NAMES):
                raise PermissionError("prohibited_content")
            _validate_shape(value, depth + 1, count, max_depth, max_fields)
    elif isinstance(payload, list):
        count[0] += len(payload)
        if count[0] > max_fields: raise ValueError("payload_field_count_exceeded")
        for value in payload: _validate_shape(value, depth + 1, count, max_depth, max_fields)
    elif isinstance(payload, str):
        if len(payload.encode("utf-8")) > MAX_STRING_BYTES: raise ValueError("payload_string_too_large")
        inspected = _security_text(payload)
        if SECRET_VALUE.search(inspected): raise PermissionError("prohibited_content")
        if inspected[:1] in "[{\"":
            try:
                decoded = json.loads(inspected)
            except (json.JSONDecodeError, TypeError):
                decoded = inspected
            if decoded != inspected:
                _validate_shape(decoded, depth + 1, count, max_depth, max_fields)
    elif isinstance(payload, float):
        if not math.isfinite(payload): raise ValueError("payload_float_non_finite")
    elif payload is not None and not isinstance(payload, (int, bool)):
        raise ValueError("payload_type_invalid")


def _validate_contract(producer: str, payload: dict[str, Any]) -> None:
    if producer != "analysis_archive":
        return
    MarketSynthesis.model_validate(payload.get("synthesis"))
    for report in payload.get("reports", []):
        SignalReport.model_validate(report)
    allowed_call = set(AgentRunView.model_fields) | {
        "kind", "raw_sanitized_output", "metadata", "selected_evidence_ids",
        "invalid_evidence_ids", "citation_resolution", "citation_status",
    }
    for call in payload.get("calls", []):
        if not isinstance(call, dict) or set(call) - allowed_call:
            raise ValueError("unknown_field")


def _transform(path: str, value: Any, action: str) -> tuple[Any, str]:
    if action == "drop": return None, "dropped"
    if isinstance(value, str):
        value = _security_text(value)
        if action == "truncate" and len(value) > 2048: return value[:2048], "truncated"
        return value, "normalized" if action == "normalize" else "retained"
    return value, "retained"


def _sanitize(path: str, value: Any, action: str) -> tuple[Any, list[tuple[str, Any, str]]]:
    if action == "drop": return None, [(path, None, "dropped")]
    if isinstance(value, dict):
        output, rows = {}, []
        for raw_key in sorted(value):
            normalized = _key(raw_key)
            child, child_rows = _sanitize(f"{path}.{normalized}", value[raw_key], action)
            if child is not None: output[normalized] = child
            rows.extend(child_rows)
        return output, rows
    if isinstance(value, list):
        output, rows = [], []
        for index, child_value in enumerate(value):
            child, child_rows = _sanitize(f"{path}[{index}]", child_value, action)
            output.append(child)
            rows.extend(child_rows)
        return output, rows
    transformed, outcome = _transform(path, value, action)
    return transformed, [(path, transformed, outcome)]


def evaluate_persistence(*, producer: str, purpose: str, sink: str,
        scope: LifecycleScope, payload: dict[str, Any], idempotency_key: str,
        observed_at: datetime, artifact_id: str | None = None) -> tuple[PersistenceDecision, dict[str, Any],
            list[TransformReceipt], RetentionSchedule | None]:
    policy = policy_for(producer, purpose, sink)
    reason = None
    if policy is None:
        reason = "unknown_producer" if producer not in {"push_evidence", "agent_analysis",
            "evaluation_case", "lifecycle_control", "provider_prompt", "analysis_archive",
            "evaluation_archive", "analysis_admission", "product_projection", "trace_event",
            "monitoring_export"} else "unknown_sink"
    try:
        _validate_shape(payload, max_depth=16 if producer == "evaluation_archive" else MAX_DEPTH,
                        max_fields=4096 if producer == "evaluation_archive"
                        else 2048 if producer == "analysis_archive" else MAX_FIELDS)
        _validate_contract(producer, payload)
    except PermissionError:
        reason = "prohibited_content"
    except ValueError as exc:
        reason = "unknown_field" if str(exc) == "unknown_field" else "invalid_payload"
    except UnicodeError:
        reason = "invalid_payload"
    if policy is not None and not reason:
        unknown = {_key(item) for item in payload} - set(policy.allowed_paths)
        if unknown: reason = "unknown_field"
    if policy is not None and not reason:
        missing_roots = sorted(path for path in MANDATORY_SAFETY_PATHS
            if path in policy.allowed_paths and path not in {_key(item) for item in payload})
        if missing_roots: reason = "missing_safety_root"
    if not reason and scope.kind == "account" and "account_id" in payload \
            and str(payload["account_id"]) != str(scope.strategy_account_id):
        reason = "scope_mismatch"
    input_digest = _digest(payload) if not reason else _digest({
        "rejected": reason, "producer": producer, "purpose": purpose, "sink": sink,
        "scope": scope.key,
    })
    base = {"producer": producer, "purpose": purpose, "sink": sink,
        "scope": scope.model_dump(mode="json"), "input_digest": input_digest,
        "idempotency_key": idempotency_key, "evaluated_at": observed_at.isoformat()}
    if reason:
        decision_body = {"schema_version": 1, **base,
            "policy_hash": policy.policy_hash if policy else "0" * 64,
            "inventory_hash": policy.inventory_hash if policy else "0" * 64,
            "outcome": "block", "reasons": [reason], "allowed_paths": [],
            "transform_receipt_hashes": [], "retention_schedule_hash": None,
            "sanitized_payload_hash": None,
            "expires_at": (observed_at + timedelta(seconds=DECISION_TTL_SECONDS)).isoformat()}
        decision_hash = _digest(decision_body)
        return PersistenceDecision.model_validate({**decision_body,
            "decision_id": f"eld_{decision_hash[:48]}", "decision_hash": decision_hash}), {}, [], None

    sanitized, receipts = {}, []
    for raw_path in sorted(payload):
        path = _key(raw_path)
        value, rows = _sanitize(path, payload[raw_path], policy.transforms[path])
        if value is not None: sanitized[path] = value
        outcomes = {item[2] for item in rows}
        outcome = next((item for item in ("dropped", "truncated", "normalized", "retained")
            if item in outcomes), "retained")
        receipt_body = {"processor": "evidence_lifecycle", "processor_version": PROCESSOR_VERSION,
            "path": path, "data_class": policy.allowed_paths[path].value,
            "outcome": outcome, "sanitized_output_hash": _digest(
                {"path": path, "value": value})}
        receipt_hash = _digest(receipt_body)
        receipts.append(TransformReceipt.model_validate({**receipt_body,
            "receipt_id": f"etr_{receipt_hash[:48]}", "decision_id": "eld_" + "0" * 48,
            "receipt_hash": receipt_hash}))
    missing = [p for p in MANDATORY_SAFETY_PATHS if p in policy.allowed_paths and p not in sanitized]
    if missing:
        raise RuntimeError("Registry transform removed a mandatory safety root")
    sanitized_hash = _digest(sanitized)
    expires_at = observed_at + timedelta(seconds=policy.retention_seconds)
    schedule_body = {"artifact_id": artifact_id or idempotency_key,
        "scope_key": scope.key,
        "body_expires_at": expires_at.isoformat(),
        "minimal_safety_paths": sorted(p for p in policy.allowed_paths
            if policy.allowed_paths[p] == DataElementClass.SAFETY_ROOT),
        "expected_copies": policy.expected_copies, "policy_hash": policy.policy_hash}
    schedule_hash = _digest(schedule_body)
    schedule = RetentionSchedule.model_validate({**schedule_body,
        "schedule_id": f"ers_{schedule_hash[:48]}", "schedule_hash": schedule_hash})
    decision_body = {"schema_version": 1, **base, "policy_hash": policy.policy_hash,
        "inventory_hash": policy.inventory_hash,
        "outcome": "transformed" if any(r.outcome != "retained" for r in receipts) else "allow",
        "reasons": ["transformed" if any(r.outcome != "retained" for r in receipts) else "allowed"],
        "allowed_paths": sorted(sanitized), "transform_receipt_hashes": sorted(r.receipt_hash for r in receipts),
        "retention_schedule_hash": schedule_hash, "sanitized_payload_hash": sanitized_hash,
        "expires_at": (observed_at + timedelta(seconds=DECISION_TTL_SECONDS)).isoformat()}
    decision_hash = _digest(decision_body)
    decision_id = f"eld_{decision_hash[:48]}"
    receipts = [r.model_copy(update={"decision_id": decision_id}) for r in receipts]
    decision = PersistenceDecision.model_validate({**decision_body,
        "decision_id": decision_id, "decision_hash": decision_hash})
    return decision, sanitized, receipts, schedule
