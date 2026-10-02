"""Mocked, exact-scope Hyperliquid account evidence capture tests."""

from datetime import datetime, timedelta, timezone

import pytest

from moeazi_agent.hyperliquid_native import AccountScope
from moeazi_agent.hyperliquid_observation import capture_hyperliquid_observation


MASTER = "0x1234567890abcdef1234567890abcdef12345678"
SUBACCOUNT = "0xabcdef1234567890abcdef1234567890abcdef12"
START, END = 1_700_000_000_000, 1_700_000_010_000

SPOT = {"balances": [{"coin": "USDC", "token": 0, "hold": "1.0",
                       "total": "10.0", "entryNtl": "9.0"}]}
PERPS = {"assetPositions": [{"position": {"coin": "BTC", "szi": "0.1"}}],
         "marginSummary": {"accountValue": "50.0", "totalMarginUsed": "5.0",
                           "totalNtlPos": "20.0", "totalRawUsd": "45.0"}, "time": END}
ORDERS = [{"coin": "BTC", "limitPx": "100.0", "oid": 12, "side": "A",
           "sz": "0.1", "timestamp": END}]
FILL = {"coin": "BTC", "oid": 12, "px": "100.0", "sz": "0.1", "fee": "0.01",
        "time": START + 100, "side": "B"}
FUNDING = [{"delta": {"coin": "BTC", "type": "funding", "usdc": "0.1"},
            "hash": "0xabc", "time": START + 200}]
TRANSFER = [{"delta": {"type": "deposit", "usdc": "5.0"},
             "hash": "0xdef", "time": START + 300}]
HISTORY = [{"order": {"coin": "BTC", "oid": 12}, "status": "filled",
            "statusTimestamp": END}]


class Response:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


class Client:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def post(self, path, *, json):
        self.calls.append((path, json))
        return Response(self.responses.pop(0))


def fixed_clock():
    value = datetime(2026, 10, 1, tzinfo=timezone.utc)

    def advance():
        nonlocal value
        value += timedelta(milliseconds=1)
        return value

    return advance


def payloads():
    return [SPOT, PERPS, ORDERS, [FILL], FUNDING, TRANSFER, HISTORY]


@pytest.mark.asyncio
async def test_master_capture_binds_every_read_and_never_claims_reconciliation():
    client = Client(payloads())
    observation = await capture_hyperliquid_observation(
        client, AccountScope(MASTER, "master"), start_time_ms=START,
        end_time_ms=END, clock=fixed_clock(),
    )

    assert [body for _, body in client.calls] == [
        {"type": "spotClearinghouseState", "user": MASTER},
        {"type": "clearinghouseState", "user": MASTER, "dex": ""},
        {"type": "openOrders", "user": MASTER, "dex": ""},
        {"type": "userFillsByTime", "user": MASTER, "startTime": START,
         "endTime": END, "aggregateByTime": False},
        {"type": "userFunding", "user": MASTER, "startTime": START, "endTime": END},
        {"type": "userNonFundingLedgerUpdates", "user": MASTER,
         "startTime": START, "endTime": END},
        {"type": "historicalOrders", "user": MASTER},
    ]
    assert observation.master_address == MASTER
    assert observation.target_address == MASTER
    assert observation.target_kind == "master"
    assert observation.spot_balances_captured
    assert observation.default_perp_positions_and_collateral_captured
    assert observation.fills_captured and observation.funding_captured
    assert observation.transfers_captured and observation.open_orders_captured
    assert observation.historical_orders_captured
    assert observation.event_windows_complete is False
    assert observation.snapshot_complete is False
    assert observation.reconciled is False
    assert observation.finality == "unknown" and observation.finality_confirmed is False
    assert observation.read_consistency == "non_atomic"
    assert observation.source_times["userFillsByTime"] == (START + 100,)
    fill_read = next(read for read in observation.reads if read.request_type == "userFillsByTime")
    funding_read = next(read for read in observation.reads if read.request_type == "userFunding")
    assert fill_read.below_response_cap is True
    assert fill_read.complete_for_requested_window is False
    assert funding_read.complete_for_requested_window is True
    assert all(read.received_at >= read.requested_at for read in observation.reads)


@pytest.mark.asyncio
async def test_subaccount_capture_verifies_master_binding_and_reads_exact_target():
    membership = [{"subAccountUser": SUBACCOUNT, "master": MASTER}]
    client = Client([membership, *payloads()])
    observation = await capture_hyperliquid_observation(
        client, AccountScope(SUBACCOUNT, "subaccount", MASTER),
        start_time_ms=START, end_time_ms=END, clock=fixed_clock(),
    )

    assert client.calls[0] == ("/info", {"type": "subAccounts", "user": MASTER})
    assert all(body["user"] == SUBACCOUNT for _, body in client.calls[1:])
    assert observation.master_address == MASTER
    assert observation.target_address == SUBACCOUNT
    assert observation.target_kind == "subaccount"


@pytest.mark.asyncio
async def test_subaccount_mismatch_fails_closed_before_target_reads():
    client = Client([[{"subAccountUser": SUBACCOUNT, "master": "0x" + "11" * 20}]])
    with pytest.raises(ValueError, match="not bound"):
        await capture_hyperliquid_observation(
            client, AccountScope(SUBACCOUNT, "subaccount", MASTER),
            start_time_ms=START, end_time_ms=END, clock=fixed_clock(),
        )
    assert len(client.calls) == 1


@pytest.mark.asyncio
async def test_capped_or_out_of_window_event_reads_do_not_claim_complete_windows():
    fills = [dict(FILL, time=START + 1) for _ in range(2_000)]
    client = Client([SPOT, PERPS, ORDERS, fills, FUNDING, TRANSFER, HISTORY])
    observation = await capture_hyperliquid_observation(
        client, AccountScope(MASTER, "master"), start_time_ms=START,
        end_time_ms=END, clock=fixed_clock(),
    )
    fill_read = next(read for read in observation.reads if read.request_type == "userFillsByTime")
    assert fill_read.cap_reached is True
    assert fill_read.below_response_cap is False
    assert fill_read.complete_for_requested_window is False
    assert observation.event_windows_complete is False
    assert observation.snapshot_complete is False

    client = Client([SPOT, PERPS, ORDERS, [dict(FILL, time=END + 1)], FUNDING, TRANSFER, HISTORY])
    with pytest.raises(ValueError, match="outside the requested window"):
        await capture_hyperliquid_observation(
            client, AccountScope(MASTER, "master"), start_time_ms=START,
            end_time_ms=END, clock=fixed_clock(),
        )
