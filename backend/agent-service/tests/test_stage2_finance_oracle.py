"""Independent Q3 exact-arithmetic examples; all values are native integers."""
import pytest

from moeazi_agent.finance_contracts import FinanceError, JournalPosting, ReservationComponent
from moeazi_agent.finance_oracle import (
    available_units, balanced_postings, cashflow_adjusted_gain,
    held_units, journal_root, perpetual_mark_pnl, projected_balances,
)


USDC = "USDC:6"
BTC = "BTC:8"
ETH = "ETH:18"
HASH = "a" * 64


def posting(asset, location, book, units):
    return JournalPosting(asset_unit_id=asset, registry_hash=HASH,
        location_id=location, book=book, units=str(units))


def balanced_event(*legs):
    rows = tuple(posting(*leg) for leg in legs)
    assert all(total == 0 for total in balanced_postings(rows).values())
    return rows


def test_spot_partial_fills_third_asset_fees_and_sale_exact_per_asset():
    balances = {}
    opening = balanced_event(
        (USDC, "wallet", "wallet", 1_000_000_000),
        (USDC, "external", "external", -1_000_000_000),
        (ETH, "wallet", "wallet", 10_000_000_000_000_000),
        (ETH, "external", "external", -10_000_000_000_000_000))
    balances = projected_balances(balances, opening)
    for _ in range(2):
        fill = balanced_event(
            (BTC, "wallet", "wallet", 1_000_000),
            (BTC, "external", "external", -1_000_000),
            (USDC, "wallet", "wallet", -250_000_000),
            (USDC, "external", "external", 250_000_000),
            (ETH, "wallet", "wallet", -600_000_000_000_000),
            (ETH, "fees", "fees", 600_000_000_000_000))
        balances = projected_balances(balances, fill)
    sale = balanced_event(
        (BTC, "wallet", "wallet", -1_000_000),
        (BTC, "external", "external", 1_000_000),
        (USDC, "wallet", "wallet", 260_000_000),
        (USDC, "external", "external", -260_000_000))
    balances = projected_balances(balances, sale)
    assert balances[(USDC, "wallet", "wallet")] == 760_000_000
    assert balances[(BTC, "wallet", "wallet")] == 1_000_000
    assert balances[(ETH, "wallet", "wallet")] == 8_800_000_000_000_000
    assert 260_000_000 - 250_000_000 == 10_000_000  # realized price gain before ETH fee valuation
    assert balances[(ETH, "fees", "fees")] == 1_200_000_000_000_000


def test_perp_multiplier_funding_and_gas_remain_separate_from_mark_pnl():
    # Two contracts, each 0.01 BTC; quote prices are USDC micro-units per BTC.
    assert perpetual_mark_pnl(2, 1, 100, 25_000_000_000, 26_000_000_000) == 20_000_000
    assert perpetual_mark_pnl(-2, 1, 100, 25_000_000_000, 26_000_000_000) == -20_000_000
    funding = balanced_event((USDC, "collateral", "collateral", -2_000_000),
                             (USDC, "funding", "funding", 2_000_000))
    gas = balanced_event((ETH, "wallet", "wallet", -100_000_000_000_000),
                         (ETH, "gas", "gas", 100_000_000_000_000))
    start = {(USDC, "collateral", "collateral"): 100_000_000,
             (ETH, "wallet", "wallet"): 1_000_000_000_000_000}
    end = projected_balances(projected_balances(start, funding), gas)
    assert end[(USDC, "collateral", "collateral")] == 98_000_000
    assert end[(ETH, "wallet", "wallet")] == 900_000_000_000_000


def test_transfer_stays_in_transit_until_destination_is_observed():
    start = {(USDC, "wallet", "wallet"): 100_000_000}
    leave = balanced_event((USDC, "wallet", "wallet", -40_000_000),
                           (USDC, "bridge", "transit", 40_000_000))
    pending = projected_balances(start, leave)
    assert pending[(USDC, "wallet", "wallet")] == 60_000_000
    assert pending[(USDC, "bridge", "transit")] == 40_000_000
    arrive = balanced_event((USDC, "bridge", "transit", -40_000_000),
                            (USDC, "venue", "collateral", 40_000_000))
    settled = projected_balances(pending, arrive)
    assert (USDC, "bridge", "transit") not in settled
    assert settled[(USDC, "venue", "collateral")] == 40_000_000


def test_cashflow_adjusted_return_and_unknown_capacity():
    assert cashflow_adjusted_gain(1_000_000_000, 1_080_000_000,
                                  100_000_000, 50_000_000) == 30_000_000
    holds = [ReservationComponent(capacity_key="USDC:wallet", asset_unit_id=USDC,
        registry_hash=HASH, location_id="wallet", units="70000000")]
    assert held_units(holds, "USDC:wallet") == 70_000_000
    assert available_units(100_000_000, 70_000_000, clean=True) == 30_000_000
    assert available_units(100_000_000, 70_000_000, clean=False) is None
    assert available_units(None, 70_000_000, clean=True) is None


def test_atomic_posting_order_does_not_change_final_state_or_journal_root():
    current = {(USDC, "wallet", "wallet"): 10}
    rows = balanced_event((USDC, "wallet", "wallet", -20),
                          (USDC, "wallet", "wallet", 20))
    assert projected_balances(current, rows) == projected_balances(current, reversed(rows))
    assert journal_root([(USDC, "wallet", "wallet", -20),
                         (USDC, "wallet", "wallet", 20)]) == journal_root([
                         (USDC, "wallet", "wallet", 20),
                         (USDC, "wallet", "wallet", -20)])
    with pytest.raises(FinanceError):
        balanced_postings((posting(USDC, "wallet", "wallet", 1),
                           posting(BTC, "external", "external", -1)))
