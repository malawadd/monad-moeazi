"""Exact cross-service identity for one scoped Uniswap user operation."""

from __future__ import annotations

from hashlib import sha256
import json
import re


ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
CALLDATA = re.compile(r"^0x(?:[0-9a-fA-F]{2})+$")


def uniswap_swap_payload_hash(*, assignment_id: str, calldata: str,
                              client_id: str, grant_id: str, owner: str,
                              scope: str, strategy_account_id: str,
                              target: str) -> str:
    if not all(isinstance(value, str) and value.strip() for value in
               (assignment_id, client_id, grant_id, strategy_account_id)):
        raise ValueError("Uniswap order identity is incomplete")
    if scope not in {"buy", "exit"}:
        raise ValueError("Uniswap order scope is invalid")
    if not isinstance(owner, str) or not ADDRESS.fullmatch(owner) \
            or not isinstance(target, str) or not ADDRESS.fullmatch(target) \
            or not isinstance(calldata, str) or not CALLDATA.fullmatch(calldata):
        raise ValueError("Uniswap order bytes or addresses are invalid")
    body = {
        "assignmentId": assignment_id, "chainId": 42161,
        "calldata": calldata.lower(), "clientId": client_id,
        "grantId": grant_id, "owner": owner.lower(), "scope": scope,
        "strategyAccountId": strategy_account_id, "target": target.lower(),
        "value": "0", "venue": "uniswap",
    }
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False, allow_nan=False)
    return sha256(("moeazi-uniswap-swap-v1\n" + encoded).encode()).hexdigest()
