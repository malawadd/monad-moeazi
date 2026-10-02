from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import text

from .evidence_lifecycle_identity import canonical_lifecycle_scope_key


def lifecycle_lock_key(scope_key: str, artifact_id: str) -> str:
    scope = canonical_lifecycle_scope_key(scope_key)
    if not artifact_id or len(artifact_id) > 180:
        raise ValueError("Lifecycle lock artifact identity is invalid")
    return f"evidence-lifecycle:v1:{scope}:{artifact_id}"


async def lock_lifecycle_artifacts(conn, scope_key: str,
        artifact_ids: Iterable[str]) -> None:
    """Serialize disclosure and governing writes in one stable global order."""
    keys = sorted({lifecycle_lock_key(scope_key, item) for item in artifact_ids})
    for lock_key in keys:
        await conn.execute(text(
            "SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"
        ), {"lock_key": lock_key})
