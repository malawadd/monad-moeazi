from __future__ import annotations

from hashlib import sha256
from typing import Any

from .dependency_safety_contracts import canonical_json
from .evidence_lifecycle_contracts import DataElementClass, DataHandlingPolicy

POLICY_VERSION = "evidence-lifecycle-v1"
PROCESSOR_VERSION = "lifecycle-sanitizer-v1"
DECISION_TTL_SECONDS = 300
MAX_DEPTH = 8
MAX_FIELDS = 512
MAX_STRING_BYTES = 262_144

PURPOSES = frozenset({"evidence_ingest", "agent_analysis", "evaluation",
    "product_projection", "monitoring", "safety_audit", "retention", "deletion",
    "recovery_validation"})
OWNERS = frozenset({"timescale_history", "convex_product_state", "redis_coordination",
    "temporal_workflows", "external_provider", "backup_owner", "public_onchain",
    "ephemeral_response"})

SINK_OWNERS = {
    "timescale.evidence_body": "timescale_history",
    "timescale.analysis_body": "timescale_history",
    "timescale.evaluation_case": "timescale_history",
    "timescale.lifecycle_receipt": "timescale_history",
    "timescale.agent_trace": "timescale_history",
    "convex.evidence_projection": "convex_product_state",
    "convex.analysis_projection": "convex_product_state",
    "redis.evidence_cache": "redis_coordination",
    "redis.lifecycle_notification": "redis_coordination",
    "redis.trace_notification": "redis_coordination",
    "temporal.analysis_payload": "temporal_workflows",
    "temporal.lifecycle_history": "temporal_workflows",
    "provider.model_request": "external_provider",
    "monitoring.evidence_output": "ephemeral_response",
    "backup.lifecycle_inventory": "backup_owner",
    "onchain.public_reference": "public_onchain",
}

SOURCE_PATHS: dict[str, dict[str, DataElementClass]] = {
    "push_evidence": {
        "content": DataElementClass.CUSTOMER_CONFIDENTIAL,
        "content_hash": DataElementClass.SAFETY_ROOT,
        "evidence_id": DataElementClass.SAFETY_ROOT,
        "market": DataElementClass.PUBLIC,
        "observed_at": DataElementClass.SAFETY_ROOT,
        "reference": DataElementClass.LINKABLE,
        "source": DataElementClass.PUBLIC,
    },
    "agent_analysis": {
        "analysis_id": DataElementClass.SAFETY_ROOT,
        "citations": DataElementClass.SAFETY_ROOT,
        "confidence_micros": DataElementClass.INTERNAL,
        "market": DataElementClass.PUBLIC,
        "summary": DataElementClass.CUSTOMER_CONFIDENTIAL,
    },
    "evaluation_case": {
        "case_id": DataElementClass.SAFETY_ROOT,
        "experiment_id": DataElementClass.SAFETY_ROOT,
        "market": DataElementClass.PUBLIC,
        "case_kind": DataElementClass.INTERNAL,
        "repetition": DataElementClass.INTERNAL,
        "market_snapshot": DataElementClass.CUSTOMER_CONFIDENTIAL,
        "evidence_snapshot": DataElementClass.CUSTOMER_CONFIDENTIAL,
        "snapshot_hash": DataElementClass.SAFETY_ROOT,
        "observed_at": DataElementClass.SAFETY_ROOT,
        "status": DataElementClass.INTERNAL,
    },
    "lifecycle_control": {
        "artifact_id": DataElementClass.SAFETY_ROOT,
        "copy_id": DataElementClass.SAFETY_ROOT,
        "policy_hash": DataElementClass.SAFETY_ROOT,
        "receipt_hash": DataElementClass.SAFETY_ROOT,
        "scope_key": DataElementClass.SAFETY_ROOT,
        "status": DataElementClass.INTERNAL,
    },
    "provider_prompt": {
        "request_id": DataElementClass.SAFETY_ROOT,
        "market": DataElementClass.PUBLIC,
        "content": DataElementClass.CUSTOMER_CONFIDENTIAL,
        "evidence_ids": DataElementClass.SAFETY_ROOT,
    },
    "analysis_archive": {
        "analysis_id": DataElementClass.SAFETY_ROOT,
        "market": DataElementClass.PUBLIC,
        "synthesis": DataElementClass.CUSTOMER_CONFIDENTIAL,
        "reports": DataElementClass.CUSTOMER_CONFIDENTIAL,
        "calls": DataElementClass.INTERNAL,
    },
    "evaluation_archive": {
        "case_id": DataElementClass.SAFETY_ROOT,
        "run_id": DataElementClass.SAFETY_ROOT,
        "content": DataElementClass.CUSTOMER_CONFIDENTIAL,
        "status": DataElementClass.INTERNAL,
    },
    "analysis_admission": {
        "account_id": DataElementClass.SAFETY_ROOT,
        "market": DataElementClass.PUBLIC,
        "profile_id": DataElementClass.SAFETY_ROOT,
        "schedule_revision": DataElementClass.SAFETY_ROOT,
    },
    "product_projection": {
        "artifact_type": DataElementClass.SAFETY_ROOT,
        "content": DataElementClass.CUSTOMER_CONFIDENTIAL,
    },
    "trace_event": {
        "content": DataElementClass.CUSTOMER_CONFIDENTIAL,
        "event_id": DataElementClass.SAFETY_ROOT,
    },
    "monitoring_export": {
        "artifact_id": DataElementClass.SAFETY_ROOT,
        "operation": DataElementClass.SAFETY_ROOT,
        "viewer_hash": DataElementClass.SAFETY_ROOT,
        "content": DataElementClass.CUSTOMER_CONFIDENTIAL,
    },
}

# A producer is not permission to use every purpose and sink.  These are the
# only runtime routes accepted by v1; adding one is a reviewed registry change.
ALLOWED_ROUTES = frozenset({
    ("push_evidence", "evidence_ingest", "timescale.evidence_body"),
    ("push_evidence", "evidence_ingest", "redis.evidence_cache"),
    ("provider_prompt", "agent_analysis", "provider.model_request"),
    ("provider_prompt", "evaluation", "provider.model_request"),
    ("analysis_archive", "agent_analysis", "timescale.analysis_body"),
    ("analysis_archive", "evaluation", "timescale.analysis_body"),
    ("evaluation_archive", "evaluation", "timescale.analysis_body"),
    ("analysis_admission", "agent_analysis", "temporal.analysis_payload"),
    ("agent_analysis", "product_projection", "convex.analysis_projection"),
    ("product_projection", "product_projection", "convex.analysis_projection"),
    ("trace_event", "monitoring", "timescale.agent_trace"),
    ("trace_event", "monitoring", "redis.trace_notification"),
    ("evaluation_case", "evaluation", "timescale.evaluation_case"),
    ("monitoring_export", "monitoring", "monitoring.evidence_output"),
    ("lifecycle_control", "retention", "timescale.lifecycle_receipt"),
    ("lifecycle_control", "safety_audit", "timescale.lifecycle_receipt"),
    ("lifecycle_control", "deletion", "timescale.lifecycle_receipt"),
    ("lifecycle_control", "deletion", "onchain.public_reference"),
    ("lifecycle_control", "recovery_validation", "backup.lifecycle_inventory"),
})


MANDATORY_SAFETY_PATHS = frozenset({"content_hash", "evidence_id", "observed_at",
    "analysis_id", "citations", "case_id", "evidence_hashes", "artifact_id", "copy_id",
    "policy_hash", "receipt_hash", "scope_key", "experiment_id", "snapshot_hash"})

DROP_FOR_EXTERNAL = frozenset({DataElementClass.PERSONAL, DataElementClass.LINKABLE,
    DataElementClass.FINANCIAL})


def _policy_body(producer: str, purpose: str, sink: str) -> dict[str, Any]:
    paths = SOURCE_PATHS[producer]
    external = SINK_OWNERS[sink] == "external_provider"
    transforms = {path: ("retain" if producer in {
            "provider_prompt", "evaluation_archive", "product_projection", "trace_event"}
            and path == "content" else
        "drop" if external and cls in DROP_FOR_EXTERNAL else
        "truncate" if cls in {DataElementClass.CUSTOMER_CONFIDENTIAL, DataElementClass.INTERNAL}
        else "normalize" if cls == DataElementClass.PUBLIC else "retain")
        for path, cls in paths.items()}
    copy_sets = {
        "timescale.evidence_body": ["timescale.evidence_body", "redis.evidence_cache",
            "backup.lifecycle_inventory"],
        "timescale.analysis_body": ["timescale.analysis_body", "convex.analysis_projection",
            "temporal.lifecycle_history", "backup.lifecycle_inventory"],
        "timescale.evaluation_case": ["timescale.evaluation_case",
            "backup.lifecycle_inventory"],
        "timescale.agent_trace": ["timescale.agent_trace", "redis.trace_notification",
            "backup.lifecycle_inventory"],
        # Monitoring response bodies are ephemeral. Only the immutable minimal root
        # is retained; no Convex or Timescale body copy exists.
        "monitoring.evidence_output": [],
    }
    expected = ["timescale.lifecycle_receipt", *copy_sets.get(sink, [sink])]
    return {"schema_version": 1, "producer": producer, "purpose": purpose, "sink": sink,
        "allowed_paths": {k: v.value for k, v in sorted(paths.items())},
        "transforms": dict(sorted(transforms.items())),
        "retention_seconds": 1800 if sink.startswith(("redis.", "temporal.")) else 604800,
        "expected_copies": sorted(expected), "policy_version": POLICY_VERSION}


def policy_for(producer: str, purpose: str, sink: str) -> DataHandlingPolicy | None:
    if (producer, purpose, sink) not in ALLOWED_ROUTES:
        return None
    body = _policy_body(producer, purpose, sink)
    inventory_hash = sha256(canonical_json({"copies": body["expected_copies"],
        "owners": {item: SINK_OWNERS.get(item, "timescale_history")
            for item in body["expected_copies"]}})).hexdigest()
    policy_hash = sha256(canonical_json({**body, "inventory_hash": inventory_hash})).hexdigest()
    return DataHandlingPolicy.model_validate({**body, "inventory_hash": inventory_hash,
        "policy_hash": policy_hash})


def policy_by_hash(policy_hash: str) -> DataHandlingPolicy | None:
    for producer, purpose, sink in ALLOWED_ROUTES:
        policy = policy_for(producer, purpose, sink)
        if policy and policy.policy_hash == policy_hash:
            return policy
    return None


def inventory_for(policy: DataHandlingPolicy) -> dict[str, str]:
    return {copy_id: SINK_OWNERS[copy_id] for copy_id in policy.expected_copies}


def registry_payload() -> dict[str, Any]:
    return {"policyVersion": POLICY_VERSION, "processorVersion": PROCESSOR_VERSION,
        "purposes": sorted(PURPOSES), "owners": sorted(OWNERS),
        "sinkOwners": dict(sorted(SINK_OWNERS.items())),
        "producerPaths": {producer: {path: cls.value for path, cls in sorted(paths.items())}
            for producer, paths in sorted(SOURCE_PATHS.items())},
        "allowedRoutes": [list(route) for route in sorted(ALLOWED_ROUTES)],
        "decisionTtlSeconds": DECISION_TTL_SECONDS}


def registry_hash() -> str:
    return sha256(canonical_json(registry_payload())).hexdigest()
