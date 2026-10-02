"""Read-only, explicitly non-authoritative Hyperliquid account evidence capture."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .hyperliquid_native import AccountScope


_EVENT_CAPS = {"userFillsByTime": 2_000, "userFunding": 500,
               "userNonFundingLedgerUpdates": 500, "historicalOrders": 2_000}
_CURRENT_READS = {"spotClearinghouseState", "clearinghouseState", "openOrders"}


class HyperliquidRead(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    request_type: str = Field(min_length=1)
    requested_user: str = Field(min_length=42, max_length=42)
    request_body: dict[str, Any]
    requested_at: datetime
    received_at: datetime
    payload: Any
    event_times_ms: tuple[int, ...] = ()
    response_count: int = Field(ge=0)
    response_cap: int | None = Field(default=None, ge=1)
    cap_reached: bool

    @model_validator(mode="after")
    def validate_read(self):
        if self.requested_at.tzinfo is None or self.received_at.tzinfo is None \
                or self.received_at < self.requested_at:
            raise ValueError("Hyperliquid read times must be ordered UTC timestamps")
        if self.request_body.get("type") != self.request_type \
                or self.request_body.get("user") != self.requested_user:
            raise ValueError("Hyperliquid read request identity changed")
        if self.response_cap is not None and self.cap_reached != (self.response_count >= self.response_cap):
            raise ValueError("Hyperliquid response cap flag is inconsistent")
        return self

    @property
    def complete_for_requested_window(self) -> bool:
        """A cap-free range response is insufficient when the source has hidden retention limits."""
        return self.request_type in _EVENT_CAPS and self.request_type != "userFillsByTime" \
            and not self.cap_reached

    @property
    def below_response_cap(self) -> bool:
        return self.response_cap is None or not self.cap_reached


class HyperliquidObservation(BaseModel):
    """Evidence contract: capture coverage is distinct from finance reconciliation."""
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    master_address: str
    target_address: str
    target_kind: Literal["master", "subaccount"]
    window_start_ms: int = Field(ge=0)
    window_end_ms: int = Field(ge=0)
    started_at: datetime
    finished_at: datetime
    reads: tuple[HyperliquidRead, ...]
    spot_balances_captured: bool
    default_perp_positions_and_collateral_captured: bool
    fills_captured: bool
    funding_captured: bool
    transfers_captured: bool
    open_orders_captured: bool
    historical_orders_captured: bool
    event_windows_complete: bool
    snapshot_complete: Literal[False] = False
    reconciled: Literal[False] = False
    finality: Literal["unknown"] = "unknown"
    finality_confirmed: Literal[False] = False
    read_consistency: Literal["non_atomic"] = "non_atomic"
    limitations: tuple[str, ...]

    @model_validator(mode="after")
    def validate_snapshot(self):
        scope = AccountScope(self.target_address, self.target_kind, self.master_address)
        if scope.address != self.target_address.lower() or scope.master_address != self.master_address.lower():
            raise ValueError("Hyperliquid observation binding must be normalized")
        if self.window_end_ms < self.window_start_ms:
            raise ValueError("Hyperliquid observation window is invalid")
        if self.started_at.tzinfo is None or self.finished_at.tzinfo is None \
                or self.finished_at < self.started_at:
            raise ValueError("Hyperliquid observation times are invalid")
        if self.event_windows_complete != all(
                read.complete_for_requested_window for read in self.reads
                if read.request_type in _EVENT_CAPS):
            raise ValueError("Hyperliquid event-window completeness flag is inconsistent")
        return self

    @property
    def source_times(self) -> dict[str, tuple[int, ...]]:
        return {read.request_type: read.event_times_ms for read in self.reads}


async def capture_hyperliquid_observation(
    client: Any,
    scope: AccountScope,
    *,
    start_time_ms: int,
    end_time_ms: int,
    clock=None,
) -> HyperliquidObservation:
    """Read exact-address Info data. This never signs, submits, or claims finality."""
    if type(start_time_ms) is not int or type(end_time_ms) is not int \
            or start_time_ms < 0 or end_time_ms < start_time_ms:
        raise ValueError("Hyperliquid observation requires an ordered millisecond window")
    now = clock or (lambda: datetime.now(timezone.utc))
    reads: list[HyperliquidRead] = []
    started = _utc(now())

    async def read(request_type: str, user: str, **params: Any) -> Any:
        body = {"type": request_type, "user": user, **params}
        requested_at = _utc(now())
        response = await client.post("/info", json=body)
        response.raise_for_status()
        payload = response.json()
        received_at = _utc(now())
        _validate_payload(request_type, payload)
        rows = payload if isinstance(payload, list) else []
        cap = _EVENT_CAPS.get(request_type)
        event_times = _event_times(request_type, payload)
        if request_type in _EVENT_CAPS and any(
                value < start_time_ms or value > end_time_ms for value in event_times):
            raise ValueError(f"Hyperliquid {request_type} returned an event outside the requested window")
        reads.append(HyperliquidRead(
            request_type=request_type, requested_user=user, request_body=body,
            requested_at=requested_at, received_at=received_at, payload=payload,
            event_times_ms=event_times, response_count=len(rows), response_cap=cap,
            cap_reached=cap is not None and len(rows) >= cap,
        ))
        return payload

    if scope.kind == "subaccount":
        members = await read("subAccounts", scope.master_address)
        match = next((row for row in members if row["subAccountUser"].lower() == scope.address), None)
        if match is None or match["master"].lower() != scope.master_address:
            raise ValueError("Hyperliquid target is not bound to the supplied master")

    spot = await read("spotClearinghouseState", scope.address)
    perps = await read("clearinghouseState", scope.address, dex="")
    orders = await read("openOrders", scope.address, dex="")
    fills = await read("userFillsByTime", scope.address, startTime=start_time_ms,
                       endTime=end_time_ms, aggregateByTime=False)
    funding = await read("userFunding", scope.address, startTime=start_time_ms, endTime=end_time_ms)
    transfers = await read("userNonFundingLedgerUpdates", scope.address,
                           startTime=start_time_ms, endTime=end_time_ms)
    history = await read("historicalOrders", scope.address)
    finished = _utc(now())
    event_reads = [item for item in reads if item.request_type in _EVENT_CAPS]
    return HyperliquidObservation(
        master_address=scope.master_address, target_address=scope.address,
        target_kind=scope.kind, window_start_ms=start_time_ms, window_end_ms=end_time_ms,
        started_at=started, finished_at=finished, reads=tuple(reads),
        spot_balances_captured=isinstance(spot.get("balances"), list),
        default_perp_positions_and_collateral_captured=isinstance(perps.get("assetPositions"), list),
        fills_captured=True, funding_captured=True, transfers_captured=True,
        open_orders_captured=True, historical_orders_captured=True,
        event_windows_complete=all(item.complete_for_requested_window for item in event_reads),
        limitations=(
            "Separate Info requests are not an atomic account snapshot.",
            "Hyperliquid Info responses do not attest finality or a shared source sequence.",
            "Current spot, default-perp, and order reads are source captures, not proven complete ledgers.",
            "openOrders on the first perp dex includes spot orders, but is not read atomically with spot balances.",
            "Perpetual positions cover only the default perp dex; HIP-3 positions need separate scoped reads.",
            "Historical orders are capped to the most recent 2000 and are not a complete order journal.",
            "Fill history has a 10000-most-recent retention limit without a completeness cursor.",
            "A time-window response at its documented cap may be truncated; earlier history is not inferred.",
        ),
    )


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("Hyperliquid source clock must return timezone-aware timestamps")
    return value.astimezone(timezone.utc)


def _event_time(request_type: str, row: dict[str, Any]) -> int:
    if request_type == "historicalOrders":
        value = row["statusTimestamp"]
    else:
        value = row["time"]
    if type(value) is not int or value < 0:
        raise ValueError(f"Malformed Hyperliquid {request_type} event timestamp")
    return value


def _event_times(request_type: str, payload: Any) -> tuple[int, ...]:
    if request_type == "clearinghouseState":
        return (payload["time"],)
    if request_type == "openOrders":
        values = tuple(row["timestamp"] for row in payload)
    elif request_type in _EVENT_CAPS or request_type == "historicalOrders":
        values = tuple(_event_time(request_type, row) for row in payload)
    else:
        return ()
    if any(type(value) is not int or value < 0 for value in values):
        raise ValueError(f"Malformed Hyperliquid {request_type} source time")
    return values


def _decimal(value: Any, field: str) -> None:
    if not isinstance(value, str):
        raise ValueError(f"Malformed Hyperliquid {field}")
    try:
        number = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError(f"Malformed Hyperliquid {field}") from exc
    if not number.is_finite():
        raise ValueError(f"Malformed Hyperliquid {field}")


def _validate_payload(request_type: str, payload: Any) -> None:
    if request_type in _CURRENT_READS:
        if request_type == "spotClearinghouseState":
            if not isinstance(payload, dict) or not isinstance(payload.get("balances"), list):
                raise ValueError("Malformed Hyperliquid spot balances")
            for row in payload["balances"]:
                if not isinstance(row, dict) or not isinstance(row.get("coin"), str) \
                        or type(row.get("token")) is not int:
                    raise ValueError("Malformed Hyperliquid spot balance identity")
                for field in ("total", "hold", "entryNtl"):
                    _decimal(row.get(field), f"spot {field}")
        elif request_type == "clearinghouseState":
            if not isinstance(payload, dict) or not isinstance(payload.get("assetPositions"), list) \
                    or type(payload.get("time")) is not int or not isinstance(payload.get("marginSummary"), dict):
                raise ValueError("Malformed Hyperliquid default-perp state")
            for field in ("accountValue", "totalMarginUsed", "totalNtlPos", "totalRawUsd"):
                _decimal(payload["marginSummary"].get(field), f"perp {field}")
            for item in payload["assetPositions"]:
                position = item.get("position") if isinstance(item, dict) else None
                if not isinstance(position, dict) or not isinstance(position.get("coin"), str):
                    raise ValueError("Malformed Hyperliquid perp position")
                _decimal(position.get("szi"), "perp size")
        else:
            if not isinstance(payload, list):
                raise ValueError("Malformed Hyperliquid open orders")
            for row in payload:
                if not isinstance(row, dict) or not isinstance(row.get("coin"), str) \
                        or type(row.get("oid")) not in (int, str) or type(row.get("timestamp")) is not int:
                    raise ValueError("Malformed Hyperliquid open order")
    elif not isinstance(payload, list):
        raise ValueError(f"Malformed Hyperliquid {request_type} response")
    elif request_type == "subAccounts":
        for row in payload:
            if not isinstance(row, dict) or not isinstance(row.get("subAccountUser"), str) \
                    or not isinstance(row.get("master"), str):
                raise ValueError("Malformed Hyperliquid subaccount binding")
    elif request_type == "historicalOrders":
        for row in payload:
            if not isinstance(row, dict) or not isinstance(row.get("order"), dict) \
                    or not isinstance(row.get("status"), str) or type(row.get("statusTimestamp")) is not int:
                raise ValueError("Malformed Hyperliquid historical order")
    elif request_type == "userFillsByTime":
        for row in payload:
            if not isinstance(row, dict) or not isinstance(row.get("coin"), str) \
                    or type(row.get("oid")) is not int:
                raise ValueError("Malformed Hyperliquid fill")
            for field in ("px", "sz", "fee"):
                _decimal(row.get(field), f"fill {field}")
    else:
        for row in payload:
            if not isinstance(row, dict) or not isinstance(row.get("delta"), dict) \
                    or not isinstance(row.get("hash"), str):
                raise ValueError(f"Malformed Hyperliquid {request_type} ledger event")
