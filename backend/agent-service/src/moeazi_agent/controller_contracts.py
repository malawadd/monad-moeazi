"""Versioned account-controller identity at the Python runtime boundary."""

from hashlib import sha256
import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ControllerRef(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schemaVersion: Literal[1]
    environment: Literal["live", "experiment"]
    strategyAccountId: str = Field(min_length=1)
    controllerKind: Literal["customer_team", "managed_program"]
    controllerId: str = Field(min_length=1)
    controllerVersionId: str = Field(min_length=1)
    contentHash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @field_validator("schemaVersion", mode="before")
    @classmethod
    def strict_schema_version(cls, value: Any) -> int:
        if type(value) is not int or value != 1:
            raise ValueError("Unsupported ControllerRef schema version")
        return value


def version_content_hash(manifest: dict[str, Any]) -> str:
    """Hash the immutable version manifest using the shared v1 wire encoding."""
    _check_canonical_value(manifest)
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        allow_nan=False)
    return sha256(("moeazi-controller-v1\n" + encoded).encode("utf-8")).hexdigest()


def _check_canonical_value(value: Any) -> None:
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise ValueError("Canonical manifest keys must be strings")
        for item in value.values():
            _check_canonical_value(item)
    elif isinstance(value, list):
        for item in value:
            _check_canonical_value(item)
    elif isinstance(value, (str, bool)):
        return
    elif type(value) is int and abs(value) <= 9_007_199_254_740_991:
        return
    else:
        raise ValueError("Canonical manifest contains an unsupported value")


def customer_version_manifest(
    strategy_account_id: str, team_id: str, team_version_id: str, config_json: str,
) -> dict[str, Any]:
    return {"schemaVersion": 1, "controllerKind": "customer_team",
        "strategyAccountId": strategy_account_id, "teamId": team_id,
        "teamVersionId": team_version_id, "configJson": config_json}


def parse_controller_ref(value: Any) -> ControllerRef:
    if not isinstance(value, dict):
        raise ValueError("ControllerRef v1 is required")
    return ControllerRef.model_validate(value)


def require_customer_binding(
    payload: dict[str, Any], authoritative: dict[str, Any] | None = None,
    *, allow_legacy: bool = False, team_id: str | None = None,
) -> ControllerRef:
    """Resolve explicit customer identity; never infer it from a profile count.

    A legacy payload can be adapted only from a fresh authoritative v1 reference
    and complete explicit aliases. It cannot invent a hash or choose a deployment.
    """
    if ("controllerRef" in payload and "controller_ref" in payload
            and payload["controllerRef"] != payload["controller_ref"]):
        raise ValueError("Conflicting ControllerRef aliases")
    raw_ref = payload.get("controllerRef", payload.get("controller_ref"))
    authority_ref = (parse_controller_ref(authoritative) if authoritative is not None else None)
    if raw_ref is None:
        if not allow_legacy or authority_ref is None:
            raise ValueError("ControllerRef v1 is required")
        ref = authority_ref
    else:
        ref = parse_controller_ref(raw_ref)
        if authority_ref is not None and ref != authority_ref:
            raise ValueError("ControllerRef differs from authoritative context")
    if ref.environment != "live" or ref.controllerKind != "customer_team":
        raise ValueError("Customer analysis requires a live customer deployment")

    aliases = (
        ("strategyAccountId", "account_id", "strategy_account_id"),
        ("teamId", "team_id"),
        ("teamVersionId", "team_version_id"),
        ("deploymentId", "deployment_id"),
    )
    expected = (ref.strategyAccountId, team_id, ref.controllerVersionId, ref.controllerId)
    present: list[bool] = []
    values: list[Any] = []
    for names in aliases:
        found = [payload[name] for name in names if name in payload and payload[name] is not None]
        if any(not isinstance(value, str) or not value for value in found):
            raise ValueError(f"Invalid {names[0]} alias")
        if found and any(value != found[0] for value in found[1:]):
            raise ValueError(f"Conflicting {names[0]} aliases")
        present.append(bool(found))
        values.append(found[0] if found else None)
    if not all(present):
        raise ValueError("Controller identity aliases are incomplete")
    for name, actual, required in zip(("account", "team", "version", "deployment"), values, expected):
        if actual is not None and required is not None and actual != required:
            raise ValueError(f"Controller {name} binding mismatch")
    return ref


def require_managed_program_binding(
    payload: dict[str, Any], authoritative: Any, *, assignment_id: str,
    program_version_id: str, content_hash: str,
) -> ControllerRef:
    """Require an exact active-assignment/version binding; managed identity is never inferred."""
    if ("controllerRef" in payload and "controller_ref" in payload
            and payload["controllerRef"] != payload["controller_ref"]):
        raise ValueError("Conflicting ControllerRef aliases")
    ref = parse_controller_ref(payload.get("controllerRef", payload.get("controller_ref")))
    current = parse_controller_ref(authoritative)
    if ref != current:
        raise ValueError("ControllerRef differs from authoritative managed assignment")
    if (ref.environment != "live" or ref.controllerKind != "managed_program"
            or ref.controllerId != assignment_id
            or ref.controllerVersionId != program_version_id or ref.contentHash != content_hash):
        raise ValueError("Managed program controller binding mismatch")
    account_values = [payload[key] for key in ("strategyAccountId", "strategy_account_id", "account_id")
                      if key in payload and payload[key] is not None]
    if not account_values or any(value != account_values[0] for value in account_values):
        raise ValueError("Managed program account identity is incomplete or conflicting")
    if account_values[0] != ref.strategyAccountId:
        raise ValueError("Managed program account binding mismatch")
    assignment_values = [payload[key] for key in ("programAssignmentId", "program_assignment_id")
                         if key in payload and payload[key] is not None]
    version_values = [payload[key] for key in ("programVersionId", "program_version_id")
                      if key in payload and payload[key] is not None]
    if (assignment_values != [assignment_id] or version_values != [program_version_id]):
        raise ValueError("Managed program assignment aliases are incomplete or conflicting")
    return ref


def customer_mode(value: str) -> Literal["shadow", "approval_required", "autopilot"]:
    if value == "insights":
        return "shadow"
    if value not in {"shadow", "approval_required", "autopilot"}:
        raise ValueError("Unknown customer authority mode")
    return value


def require_customer_mode(payload: dict[str, Any], current_mode: str,
                          *, allow_legacy: bool = False) -> str:
    customer_mode(current_mode)
    if ("controllerMode" in payload and "controller_mode" in payload
            and payload["controllerMode"] != payload["controller_mode"]):
        raise ValueError("Conflicting controller mode aliases")
    declared = payload.get("controllerMode", payload.get("controller_mode"))
    if declared is None:
        raise ValueError("Controller mode snapshot is required")
    customer_mode(declared)
    if declared != current_mode:
        raise ValueError("Controller mode changed")
    return declared
