"""Non-authoritative, deliberately tiny projection grammar."""
from __future__ import annotations
from .mandate_policy_canonical import digest

UNSUPPORTED = ("weekend", "news", "event")
def project(text: str) -> dict:
    lowered = text.lower()
    status = "unsupported" if any(word in lowered for word in UNSUPPORTED) else "ambiguous" if not text.strip() or "not" in lowered else "supported"
    return {"sourceHash": digest({"text": text}), "advisoryOnly": True,
            "clauses": [{"sourceSpan": [0, len(text)], "status": status,
                         "candidateFields": [] if status != "supported" else ["maxOrderUsd"]}]}
