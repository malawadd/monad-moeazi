"""Canonical, exact-unit identities for the isolated Asset Conservation Journal."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any

from pydantic import BaseModel

MAX = 2**256 - 1
AMOUNT = re.compile(r"^(0|[1-9][0-9]*)$")


def exact_amount(value: str) -> int:
    if not isinstance(value, str) or not AMOUNT.fullmatch(value):
        raise ValueError("amount must be a canonical base-10 integer string")
    parsed = int(value)
    if parsed <= 0 or parsed > MAX: raise ValueError("amount is outside exact uint256 bounds")
    return parsed


def normal(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
            raise ValueError("timestamps must be UTC")
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, BaseModel): return normal(value.model_dump(mode="python", exclude_none=False))
    if isinstance(value, dict):
        if any(type(key) is not str for key in value): raise ValueError("canonical keys must be strings")
        return {key: normal(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)): return [normal(item) for item in value]
    if isinstance(value, float): raise ValueError("journal records prohibit floats")
    return value


def canonical_json(value: Any) -> bytes:
    return json.dumps(normal(value), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def digest(value: Any) -> str: return sha256(canonical_json(value)).hexdigest()
