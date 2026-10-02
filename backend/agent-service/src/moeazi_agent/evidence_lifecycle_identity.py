from __future__ import annotations

from hashlib import sha256
import re


_MARKET = re.compile(r"^[A-Z0-9][A-Z0-9._:-]{0,31}$")
_ARTIFACT = re.compile(r"^[A-Za-z0-9._:-]{8,120}$")


def evaluation_owner_scope_key(owner_subject: str) -> str:
    """Registry-owned pseudonymous tenant identity for Evaluation Lab owners."""
    if not owner_subject or len(owner_subject) > 512:
        raise ValueError("Evaluation owner subject is invalid")
    tenant_id = sha256(owner_subject.encode()).hexdigest()[:40]
    return f"tenant:{tenant_id}"


def evidence_cache_key(market: str, artifact_id: str) -> str:
    """The single sanitized locator contract shared by cache write and expiry."""
    normalized = market.upper()
    if not _MARKET.fullmatch(normalized) or not _ARTIFACT.fullmatch(artifact_id):
        raise ValueError("Evidence cache locator components are invalid")
    return f"evidence:hot:{normalized}:{artifact_id}"


def canonical_lifecycle_scope_key(value: str) -> str:
    if value == "public":
        return value
    prefix, separator, subject = value.partition(":")
    if separator != ":" or prefix not in {"account", "tenant"} \
            or not subject or len(subject) > 120 or ":" in subject:
        raise ValueError("Lifecycle scope key is not canonical")
    return value
