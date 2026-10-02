import pytest

from moeazi_agent import venues
from moeazi_agent.hyperliquid_native import AccountScope


MASTER = "0x1234567890abcdef1234567890abcdef12345678"
SUBACCOUNT = "0xabcdef1234567890abcdef1234567890abcdef12"
FIXTURE_CREDENTIAL = bytes.fromhex("11" * 32)


@pytest.mark.parametrize(("operation", "coin"), [
    ("place", "BTC/USDC"),
    ("cancel", "@107"),
    ("close", "xyz:TSLA"),
])
@pytest.mark.asyncio
async def test_adapter_delegates_scoped_native_operation_truthfully(monkeypatch, operation, coin):
    calls = []
    result = {"venue": "hyperliquid", "state": "uncertain", "submitAttempted": True}

    class NativeGateway:
        def __init__(self, scope, *, base_url):
            calls.append(("init", scope, base_url))

        async def place_order(self, request, credential):
            calls.append(("place", request, credential))
            return result

        async def cancel_order(self, request, credential):
            calls.append(("cancel", request, credential))
            return result

        async def close_position(self, request, credential):
            calls.append(("close", request, credential))
            return result

    monkeypatch.setattr(venues, "HyperliquidNativeGateway", NativeGateway)
    adapter = venues.HyperliquidAdapter("https://api.hyperliquid.xyz", live_enabled=True)
    request = {
        "masterAddress": MASTER,
        "targetAddress": SUBACCOUNT,
        "targetKind": "subaccount",
        "coin": coin,
        "cloid": "0x" + "ab" * 16,
    }

    returned = await getattr(adapter, operation)(request, FIXTURE_CREDENTIAL)

    assert returned is result
    assert calls == [
        ("init", AccountScope(SUBACCOUNT, "subaccount", MASTER), "https://api.hyperliquid.xyz"),
        (operation, request, FIXTURE_CREDENTIAL),
    ]


@pytest.mark.asyncio
async def test_adapter_rejects_missing_or_ambiguous_scope_before_native_call(monkeypatch):
    calls = []

    class NativeGateway:
        def __init__(self, *args, **kwargs):
            calls.append((args, kwargs))

    monkeypatch.setattr(venues, "HyperliquidNativeGateway", NativeGateway)
    adapter = venues.HyperliquidAdapter("https://api.hyperliquid.xyz", live_enabled=True)
    missing = {"coin": "BTC", "targetAddress": MASTER, "targetKind": "master"}
    ambiguous = {
        "masterAddress": MASTER,
        "master_address": SUBACCOUNT,
        "targetAddress": MASTER,
        "targetKind": "master",
        "coin": "BTC",
    }

    with pytest.raises(ValueError, match="exact master, target, and target kind"):
        await adapter.place(missing, FIXTURE_CREDENTIAL)
    with pytest.raises(ValueError, match="exact master, target, and target kind"):
        await adapter.place(ambiguous, FIXTURE_CREDENTIAL)
    assert calls == []


@pytest.mark.asyncio
async def test_adapter_rejects_invalid_scope_and_spot_close_before_native_call(monkeypatch):
    calls = []

    class NativeGateway:
        def __init__(self, *args, **kwargs):
            calls.append((args, kwargs))

    monkeypatch.setattr(venues, "HyperliquidNativeGateway", NativeGateway)
    adapter = venues.HyperliquidAdapter("https://api.hyperliquid.xyz", live_enabled=True)
    master_target_subaccount = {
        "masterAddress": MASTER, "targetAddress": MASTER, "targetKind": "subaccount",
    }
    master_scope = {"masterAddress": MASTER, "targetAddress": MASTER, "targetKind": "master"}

    with pytest.raises(ValueError, match="subaccount target must differ"):
        await adapter.place({**master_target_subaccount, "coin": "BTC"}, FIXTURE_CREDENTIAL)
    with pytest.raises(ValueError, match="not spot balances"):
        await adapter.close({**master_scope, "coin": "BTC/USDC"}, FIXTURE_CREDENTIAL)
    assert calls == []


@pytest.mark.asyncio
async def test_adapter_preserves_spot_and_perpetual_coin_rules(monkeypatch):
    calls = []

    class NativeGateway:
        def __init__(self, scope, *, base_url):
            pass

        async def place_order(self, request, credential):
            calls.append(request["coin"])
            return {"state": "submitted"}

    monkeypatch.setattr(venues, "HyperliquidNativeGateway", NativeGateway)
    adapter = venues.HyperliquidAdapter("https://api.hyperliquid.xyz", live_enabled=True)
    scope = {"masterAddress": MASTER, "targetAddress": MASTER, "targetKind": "master"}

    for coin in ("BTC/USDC", "@107", "BTC", "xyz:TSLA"):
        await adapter.place({**scope, "coin": coin, "cloid": "0x" + "ab" * 16}, FIXTURE_CREDENTIAL)
    with pytest.raises(ValueError, match="BASE/QUOTE form"):
        await adapter.place({**scope, "coin": "BTC//USDC"}, FIXTURE_CREDENTIAL)

    assert calls == ["BTC/USDC", "@107", "BTC", "xyz:TSLA"]


@pytest.mark.asyncio
async def test_adapter_keeps_signing_gate_closed(monkeypatch):
    calls = []

    class NativeGateway:
        def __init__(self, *args, **kwargs):
            calls.append((args, kwargs))

    monkeypatch.setattr(venues, "HyperliquidNativeGateway", NativeGateway)
    adapter = venues.HyperliquidAdapter("https://api.hyperliquid.xyz", live_enabled=False)
    with pytest.raises(RuntimeError, match="certification-gated"):
        await adapter.place({}, FIXTURE_CREDENTIAL)
    assert calls == []
