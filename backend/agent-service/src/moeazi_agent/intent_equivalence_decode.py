"""Decoder for registered inert fixture encodings, never live router calldata."""
from __future__ import annotations
from datetime import datetime
from .intent_equivalence_canonical import digest, exact_uint, json_loads_strict, strict_hex
from .intent_equivalence_contracts import DecodedExecutionPlan, DecodedOperation, DispatchArtifactObservation
from .intent_equivalence_registry import raw

PREFIX = b"MOEAZI-UR-FIXTURE-1\n"

def _unknown(artifact: DispatchArtifactObservation, reason: str) -> DecodedExecutionPlan:
    body = {"artifact_hash": artifact.artifact_hash, "operation_hashes": [], "root_hash": digest({"unknown": reason}),
        "target_hashes": [], "recipient_hashes": [], "asset_hashes": [], "max_input": "0", "min_output": "0",
        "max_value": artifact.value, "max_gas": artifact.gas, "deadline": artifact.deadline, "nonces": [],
        "depth": 0, "byte_count": len(strict_hex(artifact.inert_hex)), "node_count": 0, "command_count": 0,
        "decoder_version": "decoder:v1", "certification_hash": artifact.certification_hash, "complete": False,
        "unknown_reasons": [reason]}
    return DecodedExecutionPlan(**body, plan_hash=digest(body))

def decode(artifact: DispatchArtifactObservation) -> tuple[DecodedExecutionPlan, list[DecodedOperation]]:
    """Decode only checked-in `MOEAZI-UR-FIXTURE-1` JSON bytes; unknown stays unknown."""
    limits = raw(); payload = strict_hex(artifact.inert_hex, limits["artifactBytes"])
    if artifact.kind != "calldata" or not payload.startswith(PREFIX): return _unknown(artifact, "unsupported_artifact"), []
    try: value = json_loads_strict(payload[len(PREFIX):].decode("utf-8"))
    except Exception: return _unknown(artifact, "malformed_fixture_encoding"), []
    if set(value) != {"commands", "deadline", "recipient_hash", "target_hash"} or not isinstance(value["commands"], list):
        return _unknown(artifact, "fixture_shape"), []
    if len(value["commands"]) > limits["commands"]: return _unknown(artifact, "command_ceiling"), []
    operations: list[DecodedOperation] = []
    unknown: set[str] = set()
    def visit(command: object, path: str, depth: int) -> str | None:
        if depth > limits["depth"]: unknown.add("depth_ceiling"); return None
        if not isinstance(command, dict) or set(command) - {"kind","target_hash","recipient_hash","input_unit","output_unit","amount","min_output","nonce","allow_revert","children"}:
            unknown.add("command_shape"); return None
        kind = command.get("kind")
        if kind not in {"exact_input", "permit2_transfer", "wrap", "sweep", "subplan"}: unknown.add("unknown_command"); return None
        if kind == "subplan" and not isinstance(command.get("children"), list): unknown.add("subplan_children"); return None
        children = command.get("children", [])
        if not isinstance(children, list): unknown.add("children_shape"); return None
        child_hashes = []
        for index, child in enumerate(children):
            child_hash = visit(child, f"{path}/{index}", depth + 1)
            if child_hash: child_hashes.append(child_hash)
        try:
            body = {"path": path, "kind": kind, "target_hash": command.get("target_hash", value["target_hash"]),
                "recipient_hash": command.get("recipient_hash", value["recipient_hash"]), "input_unit": command.get("input_unit"),
                "output_unit": command.get("output_unit"), "amount": command.get("amount"), "min_output": command.get("min_output"),
                "deadline": datetime.fromisoformat(value["deadline"].replace("Z", "+00:00")), "nonce": command.get("nonce"),
                "allow_revert": bool(command.get("allow_revert", False)), "child_hashes": child_hashes}
            for field in ("amount", "min_output", "nonce"):
                if body[field] is not None: exact_uint(body[field], positive=field in {"amount", "min_output"})
            operation = DecodedOperation(**body, operation_hash=digest(body)); operations.append(operation); return operation.operation_hash
        except Exception: unknown.add("command_values"); return None
    roots = []
    for index, command in enumerate(value["commands"]):
        root = visit(command, f"/{index}", 1)
        if root: roots.append(root)
    if len(operations) > limits["decodedNodes"]: return _unknown(artifact, "node_ceiling"), []
    if not roots: unknown.add("empty_or_invalid_commands")
    inputs = [exact_uint(item.amount) for item in operations if item.kind == "exact_input" and item.amount]
    outputs = [exact_uint(item.min_output) for item in operations if item.kind == "exact_input" and item.min_output]
    body = {"artifact_hash": artifact.artifact_hash, "operation_hashes": [item.operation_hash for item in operations],
        "root_hash": digest(roots), "target_hashes": sorted({item.target_hash for item in operations}),
        "recipient_hashes": sorted({item.recipient_hash for item in operations}),
        "asset_hashes": sorted({item.input_unit for item in operations if item.input_unit} | {item.output_unit for item in operations if item.output_unit}),
        "max_input": str(max(inputs, default=0)), "min_output": str(max(outputs, default=0)), "max_value": artifact.value,
        "max_gas": artifact.gas, "deadline": datetime.fromisoformat(value["deadline"].replace("Z", "+00:00")),
        "nonces": sorted({item.nonce for item in operations if item.nonce}), "depth": max((item.path.count("/") for item in operations), default=0),
        "byte_count": len(payload), "node_count": len(operations), "command_count": len(value["commands"]), "decoder_version": "decoder:v1",
        "certification_hash": artifact.certification_hash, "complete": not unknown, "unknown_reasons": sorted(unknown)}
    return DecodedExecutionPlan(**body, plan_hash=digest(body)), operations
