"""Small exact arithmetic oracle; no database, floats, or market feed access."""
from __future__ import annotations

from collections import defaultdict
from hashlib import sha256
import json
from typing import Iterable

from .finance_contracts import FinanceError, JournalPosting, ReservationComponent, native_int


def balanced_postings(postings: Iterable[JournalPosting]) -> dict[str, int]:
    totals: dict[str, int] = defaultdict(int)
    count = 0
    for item in postings:
        totals[item.asset_unit_id] += native_int(item.units)
        count += 1
    if count < 2 or any(total != 0 for total in totals.values()):
        raise FinanceError("journal postings must balance independently for each asset")
    return dict(totals)


def projected_balances(
    current: dict[tuple[str, str, str], int], postings: Iterable[JournalPosting],
) -> dict[tuple[str, str, str], int]:
    result = dict(current)
    for item in postings:
        key = item.asset_unit_id, item.location_id, item.book
        result[key] = result.get(key, 0) + native_int(item.units)
    for (_, _, book), units in result.items():
        if book in {"wallet", "collateral", "transit"} and units < 0:
            raise FinanceError("financial asset balance cannot become negative")
    return {key: value for key, value in result.items() if value != 0}


def held_units(components: Iterable[ReservationComponent], capacity_key: str) -> int:
    return sum(native_int(item.units, positive=True) for item in components
               if item.capacity_key == capacity_key)


def available_units(confirmed: int | None, held: int, *, clean: bool) -> int | None:
    if not clean or confirmed is None:
        return None
    if confirmed < 0 or held < 0 or held > confirmed:
        raise FinanceError("confirmed capacity and holds disagree")
    return confirmed - held


def cashflow_adjusted_gain(opening_equity: int, ending_equity: int,
                           deposits: int, withdrawals: int) -> int:
    """Returns native value units; caller supplies a cited common valuation unit."""
    return ending_equity - opening_equity - deposits + withdrawals


def perpetual_mark_pnl(signed_contracts: int, multiplier_numerator: int,
                       multiplier_denominator: int, entry_price: int,
                       mark_price: int) -> int:
    if multiplier_denominator <= 0 or multiplier_numerator <= 0:
        raise FinanceError("perpetual multiplier is invalid")
    numerator = signed_contracts * multiplier_numerator * (mark_price - entry_price)
    if numerator % multiplier_denominator:
        raise FinanceError("perpetual P&L cannot be represented in quoted native units")
    return numerator // multiplier_denominator


def journal_root(postings: Iterable[tuple[str, str, str, int]]) -> str:
    rows = sorted((asset, location, book, str(units))
                  for asset, location, book, units in postings if units != 0)
    raw = json.dumps(rows, separators=(",", ":"), ensure_ascii=False)
    return sha256(("moeazi-finance-journal-v1\n" + raw).encode()).hexdigest()
