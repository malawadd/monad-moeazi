import sys
from types import ModuleType

import pytest

from moeazi_agent.hyperliquid_native import AccountScope, HyperliquidNativeGateway


MASTER = "0x1234567890abcdef1234567890abcdef12345678"
SUBACCOUNT = "0xabcdef1234567890abcdef1234567890abcdef12"
FIXTURE_CREDENTIAL = bytes.fromhex("11" * 32)


class FakeInfo:
    def __init__(self, statuses, positions=None, fills=None, events=None):
        self.statuses = list(statuses)
        self.positions = positions or []
        self.fills = fills or []
        self.events = events if events is not None else []
        self.users = []

    def query_order_by_cloid(self, user, cloid):
        self.events.append("status")
        self.users.append(user)
        value = self.statuses.pop(0)
        if isinstance(value, Exception):
            raise value
        return value

    def user_state(self, user, dex):
        self.events.append("position")
        self.users.append(user)
        return {"assetPositions": self.positions}

    def user_fills(self, user):
        self.events.append("fills")
        self.users.append(user)
        return self.fills


class FakeExchange:
    def __init__(self, statuses, positions=None, fills=None):
        self.events = []
        self.info = FakeInfo(statuses, positions, fills, self.events)
        self.orders = []
        self.cancels = []
        self.closes = []
        self.order_response = {"status": "ok", "response": {"data": {"statuses": [{"resting": {"oid": 51}}]}}}

    def order(self, *args, **kwargs):
        self.events.append("order")
        self.orders.append((args, kwargs))
        return self.order_response

    def cancel_by_cloid(self, *args):
        self.events.append("cancel")
        self.cancels.append(args)
        return {"status": "ok", "response": {"data": {"statuses": [{"success": True}]}}}

    def market_close(self, *args, **kwargs):
        self.events.append("close")
        self.closes.append((args, kwargs))
        return {"status": "ok", "response": {"data": {"statuses": [
            {"filled": {"oid": 72, "totalSz": "0.4"}}
        ]}}}


def gateway_for(monkeypatch, exchange, scope=None):
    gateway = HyperliquidNativeGateway(scope or AccountScope(MASTER, "master"))
    monkeypatch.setattr(gateway, "_exchange", lambda credential: exchange)
    monkeypatch.setattr(HyperliquidNativeGateway, "_sdk_cloid", staticmethod(lambda value: value))
    return gateway


def status(value, order_id=51):
    return {"status": "order", "order": {"order": {"oid": order_id}, "status": value}}


@pytest.mark.asyncio
async def test_order_preflights_cloid_and_reports_confirmed_fill(monkeypatch):
    fill = {"oid": 51, "coin": "BTC", "sz": "0.2", "px": "70000", "time": 1}
    exchange = FakeExchange([{"status": "unknownOid"}, status("filled")], fills=[fill])
    exchange.order_response = {"status": "ok", "response": {"data": {"statuses": [{"filled": {"oid": 51}}]}}}
    gateway = gateway_for(monkeypatch, exchange)

    result = await gateway.place_order(
        {"coin": "BTC", "side": "buy", "size": "0.2", "price": "70000", "idempotency_key": "op-17"},
        FIXTURE_CREDENTIAL,
    )

    assert exchange.events == ["status", "order", "status", "fills"]
    assert result["state"] == "fill_confirmed"
    assert result["fillConfirmed"] is True
    assert result["fillObservations"] == [{"sz": "0.2", "px": "70000", "time": 1}]
    assert result["accountAddress"] == MASTER
    assert result["submitAttempted"] is True
    assert result["cloid"].startswith("0x") and len(result["cloid"]) == 34
    assert "credential" not in result


@pytest.mark.asyncio
async def test_retry_with_existing_order_status_never_resubmits(monkeypatch):
    exchange = FakeExchange([status("open")])
    gateway = gateway_for(monkeypatch, exchange)

    result = await gateway.place_order(
        {"coin": "ETH", "side": "sell", "size": 1, "price": 3000, "idempotency_key": "stable-op"},
        FIXTURE_CREDENTIAL,
    )

    assert exchange.events == ["status"]
    assert exchange.orders == []
    assert result["state"] == "submitted"
    assert result["orderStatus"] == "open"
    assert result["submitAttempted"] is False


@pytest.mark.asyncio
async def test_venue_filled_order_is_unconfirmed_without_account_fill(monkeypatch):
    exchange = FakeExchange([status("filled")])
    gateway = gateway_for(monkeypatch, exchange)

    result = await gateway.place_order(
        {"coin": "BTC", "side": "buy", "size": 0.2, "price": 70000, "idempotency_key": "status-only"},
        FIXTURE_CREDENTIAL,
    )

    assert result["state"] == "venue_filled"
    assert result["fillConfirmed"] is False
    assert exchange.events == ["status", "fills"]


@pytest.mark.asyncio
async def test_status_check_failure_stops_before_order_submission(monkeypatch):
    exchange = FakeExchange([TimeoutError()])
    gateway = gateway_for(monkeypatch, exchange)

    result = await gateway.place_order(
        {"coin": "BTC", "side": "buy", "size": 0.1, "price": 60000, "idempotency_key": "op-timeout"},
        FIXTURE_CREDENTIAL,
    )

    assert exchange.events == ["status"]
    assert exchange.orders == []
    assert result["state"] == "uncertain"
    assert result["submitAttempted"] is False


@pytest.mark.asyncio
async def test_cancel_checks_exact_subaccount_then_cancels_by_cloid(monkeypatch):
    exchange = FakeExchange([status("open"), status("canceled")])
    gateway = gateway_for(monkeypatch, exchange, AccountScope(SUBACCOUNT, "subaccount", MASTER))

    result = await gateway.cancel_order({"coin": "BTC", "cloid": "0x" + "ab" * 16}, FIXTURE_CREDENTIAL)

    assert exchange.events == ["status", "cancel", "status"]
    assert exchange.info.users == [SUBACCOUNT, SUBACCOUNT]
    assert len(exchange.cancels) == 1
    assert result["state"] == "canceled"
    assert result["accountAddress"] == SUBACCOUNT


@pytest.mark.asyncio
async def test_close_uses_exact_account_position_and_reduce_only_sdk_path(monkeypatch):
    fill = {"oid": 72, "coin": "xyz:ABC", "sz": "0.25", "px": "12.5", "time": 2}
    exchange = FakeExchange(
        [{"status": "unknownOid"}, status("filled", order_id=72)],
        [{"position": {"coin": "xyz:ABC", "szi": "-0.4"}}],
        fills=[fill],
    )
    gateway = gateway_for(monkeypatch, exchange, AccountScope(SUBACCOUNT, "subaccount", MASTER))

    result = await gateway.close_position(
        {"coin": "xyz:ABC", "size": "0.25", "idempotency_key": "close-3"}, FIXTURE_CREDENTIAL
    )

    assert exchange.events == ["status", "position", "close", "status", "fills"]
    assert exchange.info.users == [SUBACCOUNT, SUBACCOUNT, SUBACCOUNT, SUBACCOUNT]
    assert exchange.closes[0][0] == ("xyz:ABC",)
    assert exchange.closes[0][1]["sz"] == 0.25
    assert exchange.closes[0][1]["cloid"] == result["cloid"]
    assert result["state"] == "fill_confirmed"
    assert result["fillConfirmed"] is True


def test_exchange_binds_exact_master_and_subaccount_target(monkeypatch):
    captured = []

    class Account:
        @staticmethod
        def from_key(value):
            assert value == FIXTURE_CREDENTIAL
            return object()

    class Exchange:
        def __init__(self, wallet, **kwargs):
            captured.append(kwargs)

    eth_account = ModuleType("eth_account")
    eth_account.Account = Account
    hyperliquid = ModuleType("hyperliquid")
    hyperliquid.__path__ = []
    exchange_module = ModuleType("hyperliquid.exchange")
    exchange_module.Exchange = Exchange
    monkeypatch.setitem(sys.modules, "eth_account", eth_account)
    monkeypatch.setitem(sys.modules, "hyperliquid", hyperliquid)
    monkeypatch.setitem(sys.modules, "hyperliquid.exchange", exchange_module)
    HyperliquidNativeGateway(AccountScope(MASTER, "master"))._exchange(FIXTURE_CREDENTIAL)
    HyperliquidNativeGateway(AccountScope(SUBACCOUNT, "subaccount", MASTER))._exchange(FIXTURE_CREDENTIAL)

    assert captured[0]["account_address"] == MASTER
    assert captured[0]["vault_address"] is None
    assert captured[1]["account_address"] == MASTER
    assert captured[1]["vault_address"] == SUBACCOUNT
    assert captured[1]["base_url"] == "https://api.hyperliquid.xyz"


def test_exchange_rejects_hex_text_instead_of_registered_raw_key():
    with pytest.raises(ValueError, match="32-byte"):
        HyperliquidNativeGateway(AccountScope(MASTER, "master"))._exchange(b"11" * 32)
