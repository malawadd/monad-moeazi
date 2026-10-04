from __future__ import annotations

import re
from typing import Any

FORBIDDEN_TEXT = re.compile(
    r"(://|\.\.|[\\]|^/|password|credential|private[_-]?key|(?:^|[_-])env(?:$|[_-]))", re.I,
)
SAFE_SECRET_TAXONOMY = {
    "non_owner_secret_custody", "secret_custody", "platform_provider_credential",
    "external_data_credential", "restricted_venue_api_credential",
    "infrastructure_credential", "execution_credential_boundary:v1",
}


def sanitize_artifact(value: Any) -> Any:
    if isinstance(value, dict):
        if len(value) > 40:
            raise ValueError("Artifact object exceeds fixed bounds")
        if any(not isinstance(key, str) or len(key) > 80 or FORBIDDEN_TEXT.search(key)
               for key in value):
            raise ValueError("Artifact contains an unsafe field name")
        return {key: sanitize_artifact(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        if len(value) > 100:
            raise ValueError("Artifact list exceeds fixed bounds")
        return [sanitize_artifact(item) for item in value]
    if isinstance(value, str):
        if len(value) > 240 or (value not in SAFE_SECRET_TAXONOMY and FORBIDDEN_TEXT.search(value)):
            raise ValueError("Artifact contains unsafe text")
    if isinstance(value, float):
        raise ValueError("Artifact floats are prohibited")
    if value is not None and not isinstance(value, (str, int, bool)):
        raise ValueError("Artifact contains an unsupported value")
    return value
