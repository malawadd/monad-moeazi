"""Bounded spot-account evidence view over Hyperliquid's public Info capture.

This is an observation source, not a finance snapshot writer. Hyperliquid Info
does not return a common state sequence or finality attestation for the balance
and open-order reads, so this module deliberately cannot qualify evidence for
authoritative live finance admission.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .hyperliquid_native import AccountScope
from .hyperliquid_observation import HyperliquidObservation, HyperliquidRead


class HyperliquidSpotBalanceEvidence(BaseModel):
    """Raw exact decimal strings from spotClearinghouseState; no unit scaling."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    coin: str = Field(min_length=1)
    token_index: int = Field(ge=0)
    total_decimal: str
    hold_decimal: str
    entry_notional_decimal: str

    @field_validator("total_decimal", "hold_decimal", "entry_notional_decimal")
    @classmethod
    def finite_decimal(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("Hyperliquid source amounts must remain decimal strings")
        try:
            number = Decimal(value)
        except InvalidOperation as exc:
            raise ValueError("Hyperliquid source amount is malformed") from exc
        if not number.is_finite():
            raise ValueError("Hyperliquid source amount must be finite")
        return value


class HyperliquidFirstDexOpenOrderEvidence(BaseModel):
    """An order from openOrders(dex=""); that response includes spot orders."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    coin: str = Field(min_length=1)
    order_id: str = Field(min_length=1)
    side: Literal["A", "B"]
    size_decimal: str
    limit_price_decimal: str
    timestamp_ms: int = Field(ge=0)

    @field_validator("size_decimal", "limit_price_decimal")
    @classmethod
    def finite_decimal(cls, value: str) -> str:
        try:
            number = Decimal(value)
        except (InvalidOperation, TypeError) as exc:
            raise ValueError("Hyperliquid order amount is malformed") from exc
        if not number.is_finite() or number < 0:
            raise ValueError("Hyperliquid order amount must be finite and nonnegative")
        return value


class HyperliquidLiveSpotAccountEvidence(BaseModel):
    """Typed source evidence, with authority status kept separate from capture."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    evidence_version: Literal[1] = 1
    source_account_id: str = Field(min_length=1)
    master_address: str
    target_address: str
    captured_at: datetime
    spot_balances: tuple[HyperliquidSpotBalanceEvidence, ...]
    first_dex_open_orders: tuple[HyperliquidFirstDexOpenOrderEvidence, ...]
    spot_balance_holds_captured: Literal[True] = True
    spot_open_orders_included: Literal[True] = True
    open_order_scope: Literal["first_perp_dex_including_spot"] = "first_perp_dex_including_spot"
    read_consistency: Literal["non_atomic"] = "non_atomic"
    finality: Literal["unknown"] = "unknown"
    finance_admission: Literal["blocked"] = "blocked"
    finance_blockers: tuple[str, ...] = (
        "info_reads_have_no_shared_state_sequence",
        "info_source_does_not_attest_finality",
        "spot_only_capture_does_not_prove_all_account_positions_complete",
    )
    balance_request_hash: str
    balance_payload_hash: str
    orders_request_hash: str
    orders_payload_hash: str


def build_hyperliquid_live_spot_evidence(
    observation: HyperliquidObservation,
    *,
    expected_master_address: str,
) -> HyperliquidLiveSpotAccountEvidence:
    """Extract exact-account balances, per-token holds and the spot-inclusive order set.

    The address must be configured by the internal caller. Subaccounts are
    rejected here so this first finance-source slice can bind one developer
    account without introducing owner discovery or aliasing.
    """
    expected = AccountScope(expected_master_address, "master")
    if observation.target_kind != "master" \
            or observation.target_address != expected.address \
            or observation.master_address != expected.address:
        raise ValueError("Hyperliquid observation is not bound to the configured developer account")

    spot_read = _one_read(observation.reads, "spotClearinghouseState")
    orders_read = _one_read(observation.reads, "openOrders", dex="")
    if spot_read.requested_user != expected.address or orders_read.requested_user != expected.address:
        raise ValueError("Hyperliquid spot reads do not match the configured developer account")

    balances_payload = spot_read.payload
    orders_payload = orders_read.payload
    if not isinstance(balances_payload, dict) or not isinstance(balances_payload.get("balances"), list):
        raise ValueError("Hyperliquid spot balance evidence is incomplete")
    if not isinstance(orders_payload, list):
        raise ValueError("Hyperliquid first-dex open-order evidence is incomplete")

    balances = tuple(HyperliquidSpotBalanceEvidence(
        coin=row["coin"], token_index=row["token"], total_decimal=row["total"],
        hold_decimal=row["hold"], entry_notional_decimal=row["entryNtl"],
    ) for row in balances_payload["balances"])
    if len({row.token_index for row in balances}) != len(balances):
        raise ValueError("Hyperliquid spot balances contain duplicate token identities")

    orders = tuple(HyperliquidFirstDexOpenOrderEvidence(
        coin=row["coin"], order_id=str(row["oid"]), side=row["side"],
        size_decimal=row["sz"], limit_price_decimal=row["limitPx"],
        timestamp_ms=row["timestamp"],
    ) for row in orders_payload)
    if len({row.order_id for row in orders}) != len(orders):
        raise ValueError("Hyperliquid first-dex open orders contain duplicate order IDs")

    return HyperliquidLiveSpotAccountEvidence(
        source_account_id=f"hyperliquid:{expected.address}",
        master_address=expected.address,
        target_address=expected.address,
        captured_at=observation.finished_at,
        spot_balances=balances,
        first_dex_open_orders=orders,
        balance_request_hash=_read_hash(spot_read, request_only=True),
        balance_payload_hash=_read_hash(spot_read),
        orders_request_hash=_read_hash(orders_read, request_only=True),
        orders_payload_hash=_read_hash(orders_read),
    )


def _one_read(
    reads: tuple[HyperliquidRead, ...], request_type: str, *, dex: str | None = None,
) -> HyperliquidRead:
    matches = [read for read in reads if read.request_type == request_type
               and (dex is None or read.request_body.get("dex") == dex)]
    if len(matches) != 1:
        raise ValueError(f"Hyperliquid evidence requires exactly one {request_type} read")
    return matches[0]


def _read_hash(read: HyperliquidRead, *, request_only: bool = False) -> str:
    body = {"request": read.request_body}
    if not request_only:
        body["payload"] = read.payload
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False, allow_nan=False).encode("utf-8")
    return hashlib.sha256(b"moeazi-hyperliquid-live-spot-v1\n" + encoded).hexdigest()
