"""Scoped Hyperliquid API-wallet primitives; gateway callers own policy and risk checks."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
import math
import re
from collections.abc import Callable
from typing import Any, Literal


_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
_CLOID = re.compile(r"^0x[0-9a-fA-F]{32}$")
_BASE_URLS = {"https://api.hyperliquid.xyz"}


@dataclass(frozen=True)
class AccountScope:
    address: str
    kind: Literal["master", "subaccount"]
    master_address: str | None = None

    def __post_init__(self) -> None:
        if not _ADDRESS.fullmatch(self.address):
            raise ValueError("Hyperliquid account address is invalid")
        if self.kind not in {"master", "subaccount"}:
            raise ValueError("Hyperliquid account kind is invalid")
        if self.kind == "subaccount" and not self.master_address:
            raise ValueError("the master address is required for a subaccount target")
        target = self.address.lower()
        master = self.master_address.lower() if self.master_address else target
        if not _ADDRESS.fullmatch(master) or (self.kind == "master" and master != target):
            raise ValueError("Hyperliquid master account binding is invalid")
        object.__setattr__(self, "address", target)
        object.__setattr__(self, "master_address", master)


class HyperliquidNativeGateway:
    """Scoped sync-SDK wrapper; network operations run off the event loop."""

    def __init__(self, scope: AccountScope, base_url: str = "https://api.hyperliquid.xyz"):
        if base_url not in _BASE_URLS:
            raise ValueError("Hyperliquid base URL must be the official mainnet endpoint")
        self.scope = scope
        self.base_url = base_url

    async def place_order(self, request: dict[str, Any], credential: bytes) -> dict[str, Any]:
        return await asyncio.to_thread(self._place_order, request, credential)

    async def cancel_order(self, request: dict[str, Any], credential: bytes) -> dict[str, Any]:
        return await asyncio.to_thread(self._cancel_order, request, credential)

    async def close_position(self, request: dict[str, Any], credential: bytes) -> dict[str, Any]:
        return await asyncio.to_thread(self._close_position, request, credential)

    def _place_order(self, request: dict[str, Any], credential: bytes) -> dict[str, Any]:
        coin = _text(request, "coin")
        side = request.get("side")
        if side not in {"buy", "sell"}:
            raise ValueError("side must be buy or sell")
        size = _positive(request.get("size"), "size")
        price = _positive(request.get("price"), "price")
        tif = request.get("tif", "Gtc")
        if tif not in {"Gtc", "Ioc", "Alo"}:
            raise ValueError("tif must be Gtc, Ioc, or Alo")
        reduce_only = request.get("reduce_only", False)
        if not isinstance(reduce_only, bool):
            raise ValueError("reduce_only must be boolean")
        cloid = _request_cloid(request, self.scope, "order")
        exchange = self._exchange(credential)
        existing = self._existing_result(exchange, coin, cloid)
        if existing is not None:
            return existing
        submit = lambda: exchange.order(
            coin, side == "buy", size, price, {"limit": {"tif": tif}},
            reduce_only=reduce_only, cloid=self._sdk_cloid(cloid),
        )
        return self._submit_and_confirm(exchange, coin, cloid, submit)

    def _cancel_order(self, request: dict[str, Any], credential: bytes) -> dict[str, Any]:
        coin = _text(request, "coin")
        target_cloid = _normalize_cloid(_text(request, "cloid"))
        exchange = self._exchange(credential)
        existing = self._existing_result(
            exchange, coin, target_cloid, missing="not_found", continue_states={"open", "triggered"}
        )
        if existing is not None:
            return existing
        submit = lambda: exchange.cancel_by_cloid(coin, self._sdk_cloid(target_cloid))
        return self._submit_and_confirm(exchange, coin, target_cloid, submit, _cancel_ack_state)

    def _close_position(self, request: dict[str, Any], credential: bytes) -> dict[str, Any]:
        coin = _text(request, "coin")
        cloid = _request_cloid(request, self.scope, "close")
        size = _positive(request["size"], "size") if request.get("size") is not None else None
        price = _positive(request["price"], "price") if request.get("price") is not None else None
        slippage = _positive(request.get("slippage", 0.05), "slippage")
        if slippage > 0.25:
            raise ValueError("slippage must be at most 0.25")
        exchange = self._exchange(credential)
        existing = self._existing_result(exchange, coin, cloid)
        if existing is not None:
            return existing
        try:
            positions = exchange.info.user_state(self.scope.address, _dex(coin)).get("assetPositions", [])
        except Exception:
            return _result(self.scope, coin, cloid, "uncertain", submit_attempted=False)
        position_size = 0.0
        for item in positions:
            position = item.get("position", {})
            if position.get("coin") == coin:
                try:
                    position_size = float(position.get("szi", "0"))
                except (TypeError, ValueError):
                    raise ValueError("Hyperliquid returned an invalid position size") from None
                break
        if not math.isfinite(position_size):
            raise ValueError("Hyperliquid returned an invalid position size")
        if position_size == 0:
            return _result(self.scope, coin, cloid, "no_position", submit_attempted=False)
        close_size = abs(position_size) if size is None else size
        if close_size > abs(position_size):
            raise ValueError("size exceeds the current position")
        submit = lambda: exchange.market_close(
            coin, sz=close_size, px=price, slippage=slippage, cloid=self._sdk_cloid(cloid))
        return self._submit_and_confirm(exchange, coin, cloid, submit)

    def _existing_result(
        self, exchange: Any, coin: str, cloid: str, *, missing: str | None = None,
        continue_states: set[str] | None = None,
    ):
        try:
            prior = self._query_status(exchange, cloid)
        except Exception:
            return _result(self.scope, coin, cloid, "uncertain", submit_attempted=False)
        if prior["status"] == "unknownOid":
            return _result(self.scope, coin, cloid, missing, submit_attempted=False) if missing else None
        if continue_states and prior["status"] in continue_states:
            return None
        return self._result_for_status(exchange, coin, cloid, prior)

    def _submit_and_confirm(
        self, exchange: Any, coin: str, cloid: str, submit: Callable[[], Any], ack_parser=None,
    ):
        try:
            acknowledgement = submit()
        except Exception:
            try:
                after_error = self._query_status(exchange, cloid)
            except Exception:
                after_error = None
            if after_error and after_error["status"] != "unknownOid":
                return self._result_for_status(exchange, coin, cloid, after_error, True)
            return _result(self.scope, coin, cloid, "uncertain", submit_attempted=True)
        ack_state = (ack_parser or _ack_state)(acknowledgement)
        try:
            confirmed = self._query_status(exchange, cloid)
        except Exception:
            confirmed = None
        if confirmed and confirmed["status"] != "unknownOid":
            return self._result_for_status(exchange, coin, cloid, confirmed, True)
        state = ack_state if ack_state in {"venue_filled", "rejected", "submitted"} else "uncertain"
        return _result(self.scope, coin, cloid, state, submit_attempted=True)

    def _result_for_status(self, exchange, coin, cloid, status, attempted=False):
        result = _status_result(self.scope, coin, cloid, status, attempted)
        if status["status"] != "filled":
            return result
        result["fillConfirmed"] = False
        try:
            fills = exchange.info.user_fills(self.scope.address)
        except Exception:
            return result
        if status.get("orderId") is None or not isinstance(fills, list):
            return result
        matched = [f for f in fills if isinstance(f, dict) and str(f.get("oid")) == str(status["orderId"])
                   and f.get("coin") == coin]
        if matched:
            result["state"], result["fillConfirmed"] = "fill_confirmed", True
            result["fillObservations"] = [
                {k: f[k] for k in ("sz", "px", "time", "fee") if k in f} for f in matched
            ]
        return result

    def _exchange(self, credential: bytes):
        # Registration encrypts the 32 raw key bytes, not their hexadecimal text.
        if not isinstance(credential, bytes) or len(credential) != 32:
            raise ValueError("Hyperliquid credential must be a 32-byte API-wallet key")
        from eth_account import Account
        from hyperliquid.exchange import Exchange

        wallet = Account.from_key(credential)
        return Exchange(wallet, base_url=self.base_url, account_address=self.scope.master_address,
                        vault_address=self.scope.address if self.scope.kind == "subaccount" else None,
                        timeout=15)

    @staticmethod
    def _sdk_cloid(value: str):
        from hyperliquid.utils.types import Cloid

        return Cloid.from_str(value)

    def _query_status(self, exchange: Any, cloid: str) -> dict[str, Any]:
        raw = exchange.info.query_order_by_cloid(self.scope.address, self._sdk_cloid(cloid))
        if not isinstance(raw, dict):
            raise RuntimeError("Hyperliquid order status response is malformed")
        if raw.get("status") == "unknownOid":
            return {"status": "unknownOid"}
        order = raw.get("order")
        if not isinstance(order, dict):
            raise RuntimeError("Hyperliquid order status response is malformed")
        status = order.get("status")
        details = order.get("order")
        if not isinstance(status, str) or not isinstance(details, dict):
            raise RuntimeError("Hyperliquid order status response is malformed")
        return {"status": status, "orderId": details.get("oid")}


def _request_cloid(request: dict[str, Any], scope: AccountScope, operation: str) -> str:
    supplied = request.get("cloid")
    if supplied is not None:
        return _normalize_cloid(str(supplied))
    key = request.get("idempotency_key")
    if not isinstance(key, str) or not key.strip() or len(key) > 256:
        raise ValueError("a cloid or idempotency_key is required")
    digest = hashlib.sha256(f"moeazi:hyperliquid:{scope.address}:{operation}:{key}".encode()).hexdigest()
    return "0x" + digest[:32]


def _normalize_cloid(value: str) -> str:
    if not _CLOID.fullmatch(value):
        raise ValueError("cloid must be a 16-byte 0x-prefixed hex value")
    return value.lower()


def _status_result(scope, coin, cloid, status, attempted=False):
    state = status["status"]
    result_state = {"filled": "venue_filled", "open": "submitted", "triggered": "submitted",
                    "canceled": "canceled", "rejected": "rejected"}.get(
                        state, "rejected" if state.endswith("Rejected") else "terminal")
    result = _result(scope, coin, cloid, result_state, submit_attempted=attempted)
    result["orderStatus"] = state
    if status.get("orderId") is not None:
        result["orderId"] = status["orderId"]
    return result


def _ack_state(response: Any) -> str:
    if not isinstance(response, dict) or response.get("status") != "ok":
        return "uncertain"
    statuses = response.get("response", {}).get("data", {}).get("statuses", [])
    if not isinstance(statuses, list) or not statuses or not isinstance(statuses[0], dict):
        return "uncertain"
    item = statuses[0]
    for key, state in (("filled", "venue_filled"), ("resting", "submitted"), ("error", "rejected")):
        if key in item:
            return state
    return "uncertain"


def _cancel_ack_state(response: Any) -> str:
    if not isinstance(response, dict) or response.get("status") != "ok":
        return "uncertain"
    statuses = response.get("response", {}).get("data", {}).get("statuses", [])
    success = isinstance(statuses, list) and bool(statuses) and statuses[0] == {"success": True}
    return "submitted" if success else "uncertain"


def _result(scope: AccountScope, coin: str, cloid: str, state: str, *, submit_attempted: bool):
    return {"venue": "hyperliquid", "accountAddress": scope.address, "coin": coin,
            "cloid": cloid, "state": state, "submitAttempted": submit_attempted}


def _text(request: dict[str, Any], key: str) -> str:
    value = request.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise ValueError(f"{key} must be a non-empty string")
    return value.strip()


def _positive(value: Any, name: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a positive finite number") from None
    if not math.isfinite(result) or result <= 0:
        raise ValueError(f"{name} must be a positive finite number")
    return result


def _dex(coin: str) -> str:
    return coin.split(":", 1)[0] if ":" in coin else ""
