from datetime import datetime, timezone

from moeazi_agent.execution_workflow import resolve_owned_hyperliquid_trading_address


MASTER = "0x" + "1" * 40
TARGET = "0x" + "2" * 40


def context():
    return {
        "strategy": {"_id": "strategy-a"},
        "proposal": {"strategyAccountId": "strategy-a"},
        "hyperliquidTradingAddress": {
            "schemaVersion": 1, "source": "verified_hyperliquid_binding",
            "strategyAccountId": "strategy-a", "venueAccountId": "venue-a",
            "masterAddress": MASTER, "targetAddress": TARGET,
            "targetKind": "subaccount",
            "permissionExpiresAt": int(datetime.now(timezone.utc).timestamp() * 1000) + 60_000,
        },
    }


def test_verified_subaccount_address_is_used_for_native_reads():
    assert resolve_owned_hyperliquid_trading_address(context()) == TARGET


def test_missing_or_changed_scope_never_infers_an_address():
    changes = (
        lambda data: data.pop("hyperliquidTradingAddress"),
        lambda data: data["hyperliquidTradingAddress"].update(targetAddress="0x" + "F" * 40),
        lambda data: data["hyperliquidTradingAddress"].update(targetKind="master"),
        lambda data: data["hyperliquidTradingAddress"].update(strategyAccountId="other"),
        lambda data: data["hyperliquidTradingAddress"].update(permissionExpiresAt=0),
    )
    for change in changes:
        data = context()
        change(data)
        assert resolve_owned_hyperliquid_trading_address(data) is None
