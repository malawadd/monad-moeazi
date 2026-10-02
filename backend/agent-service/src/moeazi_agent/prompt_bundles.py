import hashlib
import json

from .contracts import SynthesisDraft
from .providers import specialist_prompt
from .roles import Assignment
from .security import SYSTEM_BOUNDARY


def prompt_bundle(
    assignment: Assignment, market: str, evidence: str, version: str = "agent-v2",
) -> dict:
    if version != "agent-v2":
        raise ValueError(f"Unsupported prompt bundle: {version}")
    user = specialist_prompt(assignment, market, evidence)
    schema = json.dumps(SynthesisDraft.model_json_schema(), separators=(",", ":"))
    serialized = f"{SYSTEM_BOUNDARY}\n{user}"
    return {
        "version": version,
        "system": SYSTEM_BOUNDARY,
        "user": user,
        "synthesisSchema": schema,
        "sha256": hashlib.sha256(serialized.encode()).hexdigest(),
        "estimatedInputTokens": max(1, (len(serialized) + 3) // 4),
        "estimationMethod": "utf8-character-upper-bound",
    }
