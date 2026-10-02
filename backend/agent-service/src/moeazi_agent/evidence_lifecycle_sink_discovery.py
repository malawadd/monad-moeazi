from __future__ import annotations

import ast
from collections import Counter
from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path


WRITE_METHODS = frozenset({
    "save", "save_case", "save_run", "save_operation", "save_decision_bundle",
    "save_governed_evidence", "insert", "patch", "start_workflow", "start_child_workflow",
    "execute_activity", "build_provider_bundle",
})
SQL_WRITES = frozenset({"INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE", "ALTER", "CREATE"})


@dataclass(frozen=True)
class SinkCall:
    file: str
    function: str
    kind: str
    callee: str
    ordinal: int
    fingerprint: str

    @property
    def key(self) -> str:
        return self.fingerprint


def load_sink_inventory(path: Path) -> dict:
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON object key: {key}")
            result[key] = value
        return result

    def strict_json(item: Path):
        return json.loads(item.read_text(encoding="utf-8"),
            object_pairs_hook=unique_object)

    inventory = strict_json(path)
    expected = ["evidence_lifecycle_provider_callsites.json",
        "evidence_lifecycle_provider_callsites_02.json"]
    keys = {"schemaVersion", "sinks", "pythonRoot", "pythonGroups",
        "typescriptRoots", "typescriptGroups", "providerCallsiteFiles"}
    if set(inventory) != keys or inventory.get("schemaVersion") != 5 \
            or inventory.get("providerCallsiteFiles") != expected:
        raise ValueError("Evidence sink inventory v5 parts are invalid")
    actual_parts = sorted(item.name for item in path.parent.glob(
        "evidence_lifecycle_provider_callsites*.json"))
    if actual_parts != expected:
        raise ValueError("Evidence sink inventory v5 part closure is invalid")
    callsites = []
    for filename in expected:
        part = strict_json(path.with_name(filename))
        if set(part) != {"schemaVersion", "providerCallsites"} \
                or part["schemaVersion"] != 1 \
                or not isinstance(part["providerCallsites"], list):
            raise ValueError("Evidence provider callsite inventory part is invalid")
        callsites.extend(part["providerCallsites"])
    merged = {key: value for key, value in inventory.items()
        if key != "providerCallsiteFiles"}
    merged["providerCallsites"] = callsites
    _assert_inventory_uniqueness(merged)
    return merged


def _assert_inventory_uniqueness(inventory: dict) -> None:
    def unique(items, identity, label):
        values = [identity(item) for item in items]
        if len(values) != len(set(values)):
            raise ValueError(f"Duplicate {label} in evidence sink inventory")
    unique(inventory["sinks"], lambda item: item["id"], "sink ID")
    unique(inventory["pythonGroups"], lambda item: item["kind"], "Python group")
    unique(inventory["typescriptGroups"], lambda item: item["kind"], "TypeScript group")
    providers = inventory["providerCallsites"]
    unique(providers, lambda item: tuple(sorted(item.items())), "logical provider entry")
    unique(providers, lambda item: item["fingerprint"], "provider fingerprint")


def _callee(call: ast.Call) -> str:
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return call.func.id if isinstance(call.func, ast.Name) else "unknown"


def _receiver(call: ast.Call) -> str:
    if not isinstance(call.func, ast.Attribute):
        return ""
    value = call.func.value
    if isinstance(value, ast.Name):
        return value.id.lower()
    if isinstance(value, ast.Attribute):
        return value.attr.lower()
    return ""


def _call_path(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id.lower()
    if isinstance(node, ast.Attribute):
        prefix = _call_path(node.value)
        return f"{prefix}.{node.attr.lower()}" if prefix else node.attr.lower()
    return ""


def _sql_text(node: ast.AST) -> str | None:
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
            and node.func.id == "text" and node.args:
        return _sql_text(node.args[0])
    if isinstance(node, (ast.Constant, ast.JoinedStr)):
        return str(getattr(node, "value", ""))
    return None


def _kind(node: ast.Call, filename: str) -> str | None:
    callee = _callee(node)
    path = _call_path(node.func)
    if callee == "execute":
        sql = _sql_text(node.args[0]) if node.args else None
        if sql is None:
            return "sql_dynamic"
        first = sql.strip().split(maxsplit=1)[0].upper() if sql.strip() else ""
        return "sql_write" if first in SQL_WRITES else None
    if callee == "command" and node.args and isinstance(node.args[0], ast.Constant):
        operation = str(node.args[0].value).lower()
        if operation.startswith(("record", "project", "create", "update", "complete", "fail")):
            return "service_command"
    receiver = _receiver(node)
    if callee in {"set", "setex", "publish", "xadd", "hset", "delete"} \
            and any(token in receiver for token in ("redis", "cache", "runtime", "store")):
        return "redis_write"
    if path.endswith(".responses.parse") \
            or (callee in {"get", "post", "put", "patch", "delete", "request", "send",
                "invoke", "stream", "astream", "streaming", "stream_raw"}
                and any(token in receiver for token in (
                    "client", "provider", "session", "http", "requests", "aiohttp"))) \
            or (callee in {"create", "complete", "generate"}
                and any(token in path for token in ("responses", "completions", "provider", "model"))):
        return "provider_boundary"
    if callee in WRITE_METHODS or callee.startswith(("save_", "record_", "project_")):
        if callee in {"start_workflow", "start_child_workflow", "execute_activity"}:
            return "temporal_boundary"
        if callee == "build_provider_bundle":
            return "provider_boundary"
        return "repository_write"
    if filename.endswith("monitoring_api.py") and callee in {"StreamingResponse", "JSONResponse"}:
        return "monitoring_output"
    return None


def discover_source(source: str, filename: str) -> list[SinkCall]:
    tree = ast.parse(source, filename=filename)
    raw: list[tuple[str, str, str, str]] = []

    class Visitor(ast.NodeVisitor):
        def __init__(self):
            self.functions: list[str] = []

        def visit_FunctionDef(self, node):
            self.functions.append(node.name)
            self.generic_visit(node)
            self.functions.pop()

        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_Call(self, node):
            kind = _kind(node, filename)
            if kind:
                function = self.functions[-1] if self.functions else "<module>"
                normalized = ast.dump(node, annotate_fields=True, include_attributes=False)
                raw.append((function, kind, _callee(node), normalized))
            self.generic_visit(node)

    Visitor().visit(tree)
    seen: Counter[tuple[str, str, str, str]] = Counter()
    calls: list[SinkCall] = []
    for function, kind, callee, normalized in raw:
        identity = (function, kind, callee, normalized)
        seen[identity] += 1
        ordinal = seen[identity]
        body = f"{filename}:{function}:{kind}:{callee}:{ordinal}:{normalized}"
        calls.append(SinkCall(filename, function, kind, callee, ordinal,
            sha256(body.encode()).hexdigest()))
    return calls


def discover_package(root: Path) -> list[SinkCall]:
    result: list[SinkCall] = []
    for path in sorted(root.rglob("*.py")):
        if "__pycache__" in path.parts or path.name.startswith(("execution_quality_", "shadow_tca_")) \
                or path.name in {"test_center_execution_quality.py", "test_center_shadow_tca.py"}:
            continue
        relative = path.relative_to(root).as_posix()
        result.extend(discover_source(path.read_text(encoding="utf-8"), relative))
    return result


def discover_files(root: Path, filenames: list[str] | None = None) -> list[SinkCall]:
    if filenames is None:
        return discover_package(root)
    result: list[SinkCall] = []
    for filename in filenames:
        result.extend(discover_source((root / filename).read_text(encoding="utf-8"), filename))
    return result


def assert_discovered_coverage(calls: list[SinkCall], manifest: dict) -> None:
    if isinstance(manifest, dict) and "pythonGroups" in manifest:
        groups = manifest["pythonGroups"]
        assert_discovered_coverage(calls, groups)
        actual = {call.fingerprint: call for call in calls if call.kind == "provider_boundary"}
        reviewed = {item["fingerprint"]: item for item in manifest.get("providerCallsites", [])}
        if set(actual) != set(reviewed):
            raise AssertionError("Provider dispatch callsite inventory drifted")
        required = {"fingerprint", "file", "function", "callee", "policyRoute"}
        for fingerprint, item in reviewed.items():
            call = actual[fingerprint]
            if set(item) != required or not item["policyRoute"] \
                    or (item["file"], item["function"], item["callee"]) != \
                    (call.file, call.function, call.callee):
                raise AssertionError("Provider callsite review metadata is invalid")
        return
    if isinstance(manifest, list):
        grouped: dict[str, list[SinkCall]] = {}
        for call in calls:
            grouped.setdefault(call.kind, []).append(call)
        if set(grouped) != {item["kind"] for item in manifest}:
            raise AssertionError("Sink discovery boundary groups drifted")
        for item in manifest:
            group = grouped[item["kind"]]
            root = sha256("\n".join(sorted(call.fingerprint for call in group)).encode()).hexdigest()
            required = {"kind", "count", "fingerprintRoot", "owner", "dataClass",
                "boundary", "policyRoute"}
            if set(item) != required or any(not item[key] for key in required - {"count"}):
                raise AssertionError(f"Sink metadata is incomplete: {item.get('kind')}")
            if len(group) != item["count"] or root != item["fingerprintRoot"]:
                raise AssertionError(f"Sink discovery mismatch for {item['kind']}")
        return
    expected = {key: int(value["count"] if isinstance(value, dict) else value)
        for key, value in manifest.items()}
    actual = Counter(call.fingerprint for call in calls)
    if actual != Counter(expected):
        missing = dict(Counter(expected) - actual)
        unreviewed = dict(actual - Counter(expected))
        raise AssertionError(f"Sink discovery mismatch; missing={missing}; unreviewed={unreviewed}")
    for fingerprint, value in manifest.items():
        if isinstance(value, dict):
            required = {"owner", "dataClass", "boundary", "policyRoute"}
            if set(value) != required | {"count"} or any(not value[item] for item in required):
                raise AssertionError(f"Sink metadata is incomplete: {fingerprint}")
