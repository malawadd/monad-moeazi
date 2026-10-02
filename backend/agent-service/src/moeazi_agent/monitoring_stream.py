from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

from redis.asyncio import Redis

from .dependency_safety_stream import (
    DependencySafetyStreamDisclosure, parse_safety_notification,
)
from .evidence_lifecycle_storage import EvidenceLifecycleRepository


def _trace_identity(data: str, account_id: str) -> tuple[str, str, datetime, str] | None:
    try:
        payload = json.loads(data)
    except (TypeError, ValueError):
        return None
    expected = {"schema_version", "account_id", "analysis_id", "event_id",
        "created_at", "lifecycle_decision_hash"}
    if not isinstance(payload, dict) or set(payload) != expected \
            or payload.get("schema_version") != 1 or payload.get("account_id") != account_id:
        return None
    artifact_id = payload.get("analysis_id")
    if not isinstance(artifact_id, str) or not artifact_id or len(artifact_id) > 180:
        return None
    event_id = payload.get("event_id")
    if not isinstance(event_id, str) or not event_id or len(event_id) > 240:
        return None
    try:
        created_at = datetime.fromisoformat(
            str(payload["created_at"]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return None
    if created_at.tzinfo is None:
        return None
    decision_hash = payload.get("lifecycle_decision_hash")
    if not isinstance(decision_hash, str) or len(decision_hash) != 64:
        return None
    return artifact_id, event_id, created_at, decision_hash


async def monitoring_events(account_id: str, redis_url: str, engine, *,
        viewer_subject: str = "internal_worker", convex_client=None,
        redis_client=None, pause_seconds: float = 0.05):
    """Stream notifications; trace bodies are authorized event-by-event."""
    redis = redis_client or Redis.from_url(redis_url)
    pubsub = redis.pubsub()
    trace_channel = f"agent-trace:{account_id}"
    safety_channel = f"dependency-safety:{account_id}"
    channels = [trace_channel, safety_channel]
    lifecycle = EvidenceLifecycleRepository(engine)
    safety = DependencySafetyStreamDisclosure(engine, convex_client) \
        if convex_client is not None else None
    await pubsub.subscribe(*channels)
    try:
        yield "event: ready\ndata: {}\n\n"
        while True:
            message = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=15)
            if not message or not message.get("data"):
                yield "event: heartbeat\ndata: {}\n\n"
            else:
                raw = message["data"]
                data = raw.decode() if isinstance(raw, bytes) else str(raw)
                raw_channel = message.get("channel", b"")
                channel = (raw_channel.decode() if isinstance(raw_channel, bytes)
                    else str(raw_channel))
                if channel == safety_channel and safety is not None:
                    notification = parse_safety_notification(data, account_id)
                    if notification is not None:
                        try:
                            admitted = await safety.disclose(notification, account_id,
                                viewer_subject, datetime.now(timezone.utc))
                        except Exception:
                            # Redis is only a wake-up signal. Missing, malformed,
                            # stale, superseded, cross-account, tampered, or uncertain
                            # durable authority discloses nothing.
                            pass
                        else:
                            yield f"event: safety\ndata: {json.dumps(admitted, sort_keys=True)}\n\n"
                elif channel == trace_channel:
                    identity = _trace_identity(data, account_id)
                    if identity is not None:
                        artifact_id, event_id, event_created_at, decision_hash = identity
                        try:
                            durable_body = await lifecycle.stream_trace_body(
                                artifact_id, event_id, event_created_at, decision_hash,
                                f"account:{account_id}",
                                datetime.now(timezone.utc))
                        except Exception:
                            # Missing, expired, disputed, held, deleted, partial,
                            # quarantined, or unavailable authority fails closed.
                            pass
                        else:
                            yield f"event: trace\ndata: {durable_body}\n\n"
            if pause_seconds:
                await asyncio.sleep(pause_seconds)
    finally:
        await pubsub.unsubscribe(*channels)
        await pubsub.aclose()
        await redis.aclose()
        if convex_client is not None and hasattr(convex_client, "client"):
            await convex_client.client.aclose()
