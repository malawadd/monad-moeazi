"""Scoped Redis coordination for local Test Center reservations only.

The caller supplies the isolated Test Center Redis client. This module stores no
payloads or product identifiers and never treats Redis as durable authority.
"""
from __future__ import annotations

import json

from .risk_reconciliation_contracts import RiskReservation
from .risk_reconciliation_canonical import digest

_LUA = """
local prior=redis.call('GET',KEYS[1]); if prior then return prior end
local total=tonumber(redis.call('HGET',KEYS[2],'total') or '0'); local delta=tonumber(ARGV[1]); local ceiling=tonumber(ARGV[2]);
if delta<0 or total+delta>ceiling then return 'CONFLICT' end
redis.call('HSET',KEYS[2],'total',total+delta); redis.call('EXPIRE',KEYS[2],ARGV[3]); redis.call('SET',KEYS[1],ARGV[4],'EX',ARGV[3]); return ARGV[4]
"""


def key(operator_test_id: str, run_id: str, scope_hash: str) -> str:
    return f"moeazi:test-center:risk-reservations:v1:{operator_test_id}:{run_id}:{scope_hash}"


async def reserve(redis, operator_test_id: str, run_id: str, reservation: RiskReservation,
                  ceiling: int, ttl_seconds: int) -> str:
    """Atomically replay exact retry or reject conflict inside a generated namespace."""
    scope_hash = digest(reservation.scope)
    prefix = key(operator_test_id, run_id, scope_hash)
    payload = json.dumps({"reservationHash": reservation.reservation_hash, "state": reservation.state}, sort_keys=True)
    result = await redis.eval(_LUA, 2, f"{prefix}:request:{reservation.request_hash}", f"{prefix}:totals",
        str(sum(reservation.deltas.values())), str(ceiling), str(ttl_seconds), payload)
    if result == "CONFLICT": raise RuntimeError("isolated risk reservation ceiling conflict")
    if result != payload: raise RuntimeError("isolated risk reservation retry conflict")
    return result
