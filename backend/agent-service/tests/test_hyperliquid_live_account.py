"""Offline tests for the bounded Hyperliquid spot account evidence view."""

from datetime import datetime, timedelta, timezone

import pytest

from moeazi_agent.hyperliquid_live_account import build_hyperliquid_live_spot_evidence
from moeazi_agent.hyperliquid_native import AccountScope
from moeazi_agent.hyperliquid_observation import capture_hyperliquid_observation


MASTER = "0x1234567890abcdef1234567890abcdef12345678"
OTHER = "0xabcdef1234567890abcdef1234567890abcdef12"
START, END = 1_700_000_000_000, 1_700_000_010_000
SPOT = {"balances": [{"coin": "USDC", "token": 0, "hold": "1.25000001",
                       "total": "10.00000003", "entryNtl": "9.0"}]}
PERPS = {"assetPositions": [], "marginSummary": {"accountValue": "0",
    "totalMarginUsed": "0", "totalNtlPos": "0", "totalRawUsd": "0"}, "time": END}
ORDERS = [
    {"coin": "@107", "limitPx": "2.5", "oid": 123, "side": "B",
     "sz": "4.0", "timestamp": END},
    {"coin": "BTC", "limitPx": "100.0", "oid": 124, "side": "A",
     "sz": "0.1", "timestamp": END},
]


class Response:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


class Client:
    def __init__(self):
        self.responses = [SPOT, PERPS, ORDERS, [], [], [], []]
        self.calls = []

    async def post(self, path, *, json):
        self.calls.append((path, json))
        return Response(self.responses.pop(0))


def clock():
    current = datetime(2026, 10, 1, tzinfo=timezone.utc)

    def advance():
        nonlocal current
        current += timedelta(milliseconds=1)
        return current

    return advance


@pytest.mark.asyncio
async def test_live_spot_evidence_binds_exact_account_and_exposes_holds_and_orders():
    client = Client()
    captured = await capture_hyperliquid_observation(
        client, AccountScope(MASTER, "master"), start_time_ms=START,
        end_time_ms=END, clock=clock(),
    )

    evidence = build_hyperliquid_live_spot_evidence(
        captured, expected_master_address=MASTER,
    )

    assert client.calls[0][1] == {"type": "spotClearinghouseState", "user": MASTER}
    assert client.calls[2][1] == {"type": "openOrders", "user": MASTER, "dex": ""}
    assert evidence.source_account_id == f"hyperliquid:{MASTER}"
    assert evidence.spot_balances[0].total_decimal == "10.00000003"
    assert evidence.spot_balances[0].hold_decimal == "1.25000001"
    # Preserve the whole first-dex set: Hyperliquid includes spot orders there,
    # but this endpoint can also include first-dex perpetual orders.
    assert [row.coin for row in evidence.first_dex_open_orders] == ["@107", "BTC"]
    assert evidence.spot_balance_holds_captured is True
    assert evidence.spot_open_orders_included is True
    assert evidence.open_order_scope == "first_perp_dex_including_spot"
    assert evidence.finance_admission == "blocked"
    assert "info_reads_have_no_shared_state_sequence" in evidence.finance_blockers
    assert "info_source_does_not_attest_finality" in evidence.finance_blockers
    assert evidence.finality == "unknown" and evidence.read_consistency == "non_atomic"
    assert len(evidence.balance_payload_hash) == len(evidence.orders_payload_hash) == 64


@pytest.mark.asyncio
async def test_live_spot_evidence_rejects_other_or_subaccount_targets():
    observation = await capture_hyperliquid_observation(
        Client(), AccountScope(MASTER, "master"), start_time_ms=START,
        end_time_ms=END, clock=clock(),
    )

    with pytest.raises(ValueError, match="not bound to the configured developer account"):
        build_hyperliquid_live_spot_evidence(
            observation, expected_master_address=OTHER,
        )

