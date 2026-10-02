"""Python half of the shared exact finance-projection golden vector."""
import json
from datetime import datetime, timezone
from pathlib import Path

from moeazi_agent.finance_projection import projection_hash, projection_payload


GOLDEN = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "stage2FinanceProjection.json"
EXPECTED_HASH = "c25a56574609baa3465d7c571efb0b5695bb56b21a723000eebcf47ea91e9abb"


def test_projection_exact_units_unicode_sort_millis_and_deficit_match_golden():
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    account = dict(environment="experiment", scope_id="run-🧪",
        strategy_account_id="acct-مرحبا", revision=9_007_199_254_740_993,
        writer_epoch=4, authority_epoch=7, reconciliation_state="quarantined",
        reconciliation_reason="observed_below_retained_hold",
        observation_snapshot_hash="a" * 64,
        observed_at=datetime(2026, 9, 30, 11, 59, 59, 987654, tzinfo=timezone.utc))
    balances = [
        dict(asset_unit_id="USDC:6", registry_hash="c" * 64,
             location_id="wallet", book="wallet", units=9_007_199_254_740_993),
        dict(asset_unit_id="BTC:8", registry_hash="b" * 64,
             location_id="venue", book="collateral", units=1),
    ]
    holds = [
        dict(reservation_id="r-z", capacity_key="a:BTC", asset_unit_id="BTC:8",
             location_id="venue", units=2, status="reserved"),
        dict(reservation_id="r-a", capacity_key="z:USDC", asset_unit_id="USDC:6",
             location_id="wallet", units=100, status="uncertain"),
    ]
    capacity = [
        dict(capacity_key="z:USDC", asset_unit_id="USDC:6", location_id="wallet",
             limit_units=9_007_199_254_740_993),
        dict(capacity_key="a:BTC", asset_unit_id="BTC:8", location_id="venue",
             limit_units=1),
    ]
    as_of = datetime(2026, 9, 30, 12, 0, 0, 123456, tzinfo=timezone.utc)
    actual = projection_payload(account, balances, holds, capacity, as_of)
    assert actual == expected
    assert actual["capacity"][0]["availableUnits"] == "-1"
    assert projection_hash(actual) == EXPECTED_HASH
    assert projection_hash(expected) == EXPECTED_HASH


def test_projection_array_order_uses_unicode_code_points():
    account = dict(environment="experiment", scope_id="run-a",
        strategy_account_id="acct-a", revision=1, writer_epoch=1,
        authority_epoch=1, reconciliation_state="unknown",
        reconciliation_reason="no_observation", observation_snapshot_hash=None,
        observed_at=None)
    rows = [dict(asset_unit_id="🧪:asset", registry_hash="a" * 64,
                 location_id="wallet", book="wallet", units=1),
            dict(asset_unit_id="\uE000:asset", registry_hash="b" * 64,
                 location_id="wallet", book="wallet", units=1)]
    value = projection_payload(account, rows, [], [],
        datetime(2026, 9, 30, tzinfo=timezone.utc))
    assert [item["assetUnitId"] for item in value["balances"]] == ["\uE000:asset", "🧪:asset"]
