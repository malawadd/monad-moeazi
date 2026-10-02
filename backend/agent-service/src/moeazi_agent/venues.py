from abc import ABC, abstractmethod
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import re
from typing import Any

import httpx

from .contracts import StrictModel
from .hyperliquid_native import AccountScope, HyperliquidNativeGateway


class Quote(StrictModel):
    venue: str
    reference: str
    market: str
    input_amount: str
    output_amount: str
    expires_at: datetime
    raw: dict[str, Any]


class VenueHealth(StrictModel):
    venue: str
    healthy: bool
    live_submission_enabled: bool
    reason: str | None = None


class VenueAdapter(ABC):
    name: str

    @abstractmethod
    async def quote(self, request: dict[str, Any]) -> Quote: ...
    @abstractmethod
    async def balance(self, account: str) -> dict[str, Any]: ...
    @abstractmethod
    async def positions(self, account: str) -> list[dict[str, Any]]: ...
    @abstractmethod
    async def place(self, request: dict[str, Any], credential: bytes) -> dict[str, Any]: ...
    @abstractmethod
    async def cancel(self, request: dict[str, Any], credential: bytes) -> dict[str, Any]: ...
    @abstractmethod
    async def close(self, request: dict[str, Any], credential: bytes) -> dict[str, Any]: ...
    @abstractmethod
    async def reconcile(self, account: str) -> dict[str, Any]: ...
    @abstractmethod
    async def health(self) -> VenueHealth: ...


class CertificationBlockedAdapter(VenueAdapter):
    def __init__(self, name: str, reason: str = "Sandbox and funded canaries not certified"):
        self.name, self.reason = name, reason

    async def _blocked(self):
        raise RuntimeError(f"{self.name} execution blocked: {self.reason}")

    async def quote(self, request): return await self._blocked()
    async def balance(self, account): return await self._blocked()
    async def positions(self, account): return await self._blocked()
    async def place(self, request, credential): return await self._blocked()
    async def cancel(self, request, credential): return await self._blocked()
    async def close(self, request, credential): return await self._blocked()
    async def reconcile(self, account): return await self._blocked()
    async def health(self): return VenueHealth(venue=self.name, healthy=False, live_submission_enabled=False, reason=self.reason)


class HyperliquidAdapter(VenueAdapter):
    name = "hyperliquid"
    _ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
    _DECIMAL = re.compile(r"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$")
    _NATIVE_ASSET = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
    _SPOT_ASSET_ID = re.compile(r"^@[0-9]+$")

    def __init__(self, base_url: str, live_enabled: bool):
        self.client = httpx.AsyncClient(base_url=base_url, timeout=15)
        self.base_url = base_url
        self.live_enabled = live_enabled

    async def quote(self, request: dict[str, Any]) -> Quote:
        market = str(request.get("market", "")).upper()
        coin = market.replace("-PERP", "").replace("-USD", "")
        response = await self.client.post("/info", json={"type": "allMids"})
        response.raise_for_status()
        mids = response.json()
        if coin not in mids:
            raise ValueError(f"Hyperliquid market not found: {market}")
        price = str(mids[coin])
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        return Quote(
            venue=self.name,
            reference=f"hl:{coin}:{int(now.timestamp() * 1000)}",
            market=market,
            input_amount=str(request.get("size_usd", "0")),
            output_amount=price,
            expires_at=now + timedelta(seconds=10),
            raw={"price": price, "coin": coin, "source": "hyperliquid-allMids"},
        )

    async def balance(self, account: str) -> dict[str, Any]:
        response = await self.client.post("/info", json={"type": "clearinghouseState", "user": account})
        response.raise_for_status()
        return response.json()

    async def positions(self, account: str) -> list[dict[str, Any]]:
        state = await self.balance(account)
        return state.get("assetPositions", [])

    async def place(self, request, credential):
        gateway, _coin, _is_spot = self._native_gateway(request)
        return await gateway.place_order(request, credential)

    async def cancel(self, request, credential):
        gateway, _coin, _is_spot = self._native_gateway(request)
        return await gateway.cancel_order(request, credential)

    async def close(self, request, credential):
        gateway, _coin, _is_spot = self._native_gateway(request, require_perpetual=True)
        return await gateway.close_position(request, credential)

    def _native_gateway(
        self, request: dict[str, Any], *, require_perpetual: bool = False,
    ) -> tuple[HyperliquidNativeGateway, str, bool]:
        if not self.live_enabled:
            raise RuntimeError("Hyperliquid signing remains certification-gated")
        if not isinstance(request, dict):
            raise ValueError("Hyperliquid execution requires an explicit request object")

        scope = self._native_scope(request)
        coin, is_spot = self._native_coin(request)
        if require_perpetual and is_spot:
            raise ValueError("Hyperliquid close supports perpetual positions, not spot balances")
        return HyperliquidNativeGateway(scope, base_url=self.base_url), coin, is_spot

    @staticmethod
    def _native_scope(request: dict[str, Any]) -> AccountScope:
        aliases = {
            "master_address": ("masterAddress", "master_address"),
            "target_address": ("targetAddress", "target_address"),
            "target_kind": ("targetKind", "target_kind"),
        }
        values = {}
        for field, choices in aliases.items():
            present = [key for key in choices if key in request]
            if len(present) != 1:
                raise ValueError("Hyperliquid request requires one exact master, target, and target kind")
            values[field] = request[present[0]]
        if not isinstance(values["master_address"], str) or not isinstance(values["target_address"], str) \
                or not isinstance(values["target_kind"], str):
            raise ValueError("Hyperliquid master, target, and target kind must be strings")

        ambiguous_scope_fields = {
            "account", "accountAddress", "account_address", "accountScope", "account_scope", "scope",
        }
        if ambiguous_scope_fields.intersection(request):
            raise ValueError("Hyperliquid request contains an ambiguous account scope")

        scope = AccountScope(
            address=values["target_address"],
            kind=values["target_kind"],
            master_address=values["master_address"],
        )
        if scope.kind == "subaccount" and scope.address == scope.master_address:
            raise ValueError("Hyperliquid subaccount target must differ from its master")
        return scope

    @classmethod
    def _native_coin(cls, request: dict[str, Any]) -> tuple[str, bool]:
        coin = request.get("coin")
        if not isinstance(coin, str) or not coin.strip() or len(coin) > 128:
            raise ValueError("Hyperliquid coin must be a non-empty supported market identifier")
        coin = coin.strip()
        if cls._SPOT_ASSET_ID.fullmatch(coin):
            return coin, True
        if "/" in coin:
            parts = coin.split("/")
            if len(parts) == 2 and all(cls._NATIVE_ASSET.fullmatch(part) for part in parts):
                return coin, True
            raise ValueError("Hyperliquid spot coin must use BASE/QUOTE form")
        if ":" in coin:
            parts = coin.split(":")
            if len(parts) == 2 and all(cls._NATIVE_ASSET.fullmatch(part) for part in parts):
                return coin, False
            raise ValueError("Hyperliquid perpetual coin must use DEX:COIN form")
        if cls._NATIVE_ASSET.fullmatch(coin):
            return coin, False
        raise ValueError("Hyperliquid coin must be a supported spot or perpetual market identifier")

    async def reconcile(self, account: str) -> dict[str, Any]:
        user = self._validated_user_address(account)
        # On-demand only: documented weights are 2 + 2 + 20; do not poll this read.
        spot_read = await self._read_account_info(user, "spotClearinghouseState")
        spot_balances = self._spot_balances(spot_read["payload"])
        perp_read = await self._read_account_info(user, "clearinghouseState")
        perp_state = self._perpetual_state(perp_read["payload"])
        orders_read = await self._read_account_info(user, "openOrders")
        open_orders = self._open_orders(orders_read["payload"])
        return {
            "venue": self.name, "account": user,
            # Keep the historical field for callers that only consumed positions.
            "positions": perp_state["assetPositions"],
            "spotBalances": spot_balances,
            "perpetualAccountState": perp_state,
            "openOrders": open_orders,
            "snapshot": {
                "status": "partial", "certified": False,
                "readConsistency": "non_atomic",
                "coverage": "default_perp_dex_and_first_spot_dex",
                "capturedAt": orders_read["receivedAt"],
                "limitations": [
                    "This partial observation is not an authoritative account reconciliation.",
                    "Only the default perpetual dex and first spot dex are queried; HIP-3 dexes are not covered.",
                    "Only the exact supplied address is queried; other master/subaccount addresses are not discovered.",
                    "Separate public reads are not atomic and may reflect different account states.",
                    "Fills, order-status history, funding, and transfer history are not reconciled.",
                ],
                "sourceReads": {"spotClearinghouseState": spot_read,
                    "clearinghouseState": perp_read, "openOrders": orders_read},
            },
        }

    @classmethod
    def _validated_user_address(cls, account: str) -> str:
        if not isinstance(account, str) or not cls._ADDRESS.fullmatch(account):
            raise ValueError("Hyperliquid reconciliation requires one exact 0x account address")
        return account

    async def _read_account_info(self, user: str, request_type: str) -> dict[str, Any]:
        requested_at = self._now()
        response = await self.client.post("/info", json={"type": request_type, "user": user})
        response.raise_for_status()
        payload = response.json()
        received_at = self._now()
        return {"requestType": request_type, "requestedAt": requested_at,
                "receivedAt": received_at, "payload": payload}

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @classmethod
    def _decimal(cls, value: Any, field: str) -> Decimal:
        if not isinstance(value, str) or not cls._DECIMAL.fullmatch(value):
            raise ValueError(f"Malformed Hyperliquid {field}")
        try:
            parsed = Decimal(value)
        except InvalidOperation as exc:
            raise ValueError(f"Malformed Hyperliquid {field}") from exc
        if not parsed.is_finite():
            raise ValueError(f"Malformed Hyperliquid {field}")
        return parsed

    @classmethod
    def _spot_balances(cls, payload: Any) -> list[dict[str, Any]]:
        if not isinstance(payload, dict) or not isinstance(payload.get("balances"), list):
            raise ValueError("Malformed Hyperliquid spot clearinghouse response")
        seen_tokens = set()
        for row in payload["balances"]:
            if not isinstance(row, dict) or not isinstance(row.get("coin"), str) or \
                    not row["coin"] or type(row.get("token")) is not int or row["token"] < 0 or \
                    row["token"] in seen_tokens:
                raise ValueError("Malformed Hyperliquid spot balance identity")
            seen_tokens.add(row["token"])
            for field in ("hold", "total", "entryNtl"):
                if cls._decimal(row.get(field), field) < 0:
                    raise ValueError(f"Malformed Hyperliquid spot {field}")
        return payload["balances"]

    @classmethod
    def _perpetual_state(cls, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict) or not isinstance(payload.get("assetPositions"), list) or \
                type(payload.get("time")) is not int:
            raise ValueError("Malformed Hyperliquid perpetual clearinghouse response")
        for row in payload["assetPositions"]:
            position = row.get("position") if isinstance(row, dict) else None
            if not isinstance(position, dict) or not isinstance(position.get("coin"), str) or \
                    not position["coin"]:
                raise ValueError("Malformed Hyperliquid perpetual position")
            cls._decimal(position.get("szi"), "position size")
        summary = payload.get("marginSummary")
        if not isinstance(summary, dict):
            raise ValueError("Malformed Hyperliquid perpetual margin summary")
        for field in ("accountValue", "totalMarginUsed", "totalNtlPos", "totalRawUsd"):
            cls._decimal(summary.get(field), f"margin {field}")
        return payload

    @classmethod
    def _open_orders(cls, payload: Any) -> list[dict[str, Any]]:
        if not isinstance(payload, list):
            raise ValueError("Malformed Hyperliquid open orders response")
        for row in payload:
            if not isinstance(row, dict) or not isinstance(row.get("coin"), str) or \
                    not row["coin"] or type(row.get("oid")) not in (int, str) or \
                    row.get("side") not in {"A", "B"} or type(row.get("timestamp")) is not int:
                raise ValueError("Malformed Hyperliquid open order identity")
            cls._decimal(row.get("limitPx"), "order limit price")
            cls._decimal(row.get("sz"), "order size")
        return payload

    async def health(self) -> VenueHealth:
        try:
            response = await self.client.post("/info", json={"type": "meta"})
            response.raise_for_status()
            return VenueHealth(
                venue=self.name, healthy=True,
                live_submission_enabled=False,
                reason="Public reads ready; scoped API-wallet signing is not configured",
            )
        except Exception as exc:
            return VenueHealth(
                venue=self.name, healthy=False, live_submission_enabled=False,
                reason=str(exc)[:200],
            )


class UniswapTradingApiAdapter(VenueAdapter):
    name = "uniswap"

    def __init__(self, base_url: str, api_key: str, live_enabled: bool):
        self.client = httpx.AsyncClient(
            base_url=base_url, timeout=20,
            headers={"x-api-key": api_key, "Content-Type": "application/json", "x-universal-router-version": "2.0"},
        )
        self.live_enabled = live_enabled

    async def check_approval(self, request: dict[str, Any]) -> dict[str, Any]:
        response = await self.client.post("/check_approval", json=request)
        response.raise_for_status()
        return response.json()

    async def quote(self, request: dict[str, Any]) -> Quote:
        response = await self.client.post("/quote", json=request)
        response.raise_for_status()
        raw = response.json()
        quote = raw.get("quote", raw)
        from datetime import timedelta
        return Quote(
            venue=self.name, reference=str(raw.get("requestId") or raw.get("quoteId") or "uniswap"),
            market=f"{request.get('tokenIn')}/{request.get('tokenOut')}",
            input_amount=str(request.get("amount", "0")), output_amount=str(quote.get("output", {}).get("amount", "0")),
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=30), raw=raw,
        )

    @staticmethod
    def swap_body(quote_response: dict[str, Any], signature: str | None = None) -> dict[str, Any]:
        body = {key: value for key, value in quote_response.items()
                if key not in {"permitData", "permitTransaction", "moeazi"}}
        permit = quote_response.get("permitData")
        routing = str(quote_response.get("routing") or quote_response.get("quote", {}).get("routing") or "CLASSIC").upper()
        if routing in {"DUTCH_V2", "DUTCH_V3", "PRIORITY"}:
            if signature:
                body["signature"] = signature
        elif signature and isinstance(permit, dict):
            body["signature"], body["permitData"] = signature, permit
        return body

    async def build_swap(self, quote_response: dict[str, Any], signature: str | None = None) -> dict[str, Any]:
        response = await self.client.post("/swap", json=self.swap_body(quote_response, signature))
        response.raise_for_status()
        result = response.json()
        self.validate_transaction(result)
        return result

    @staticmethod
    def validate_transaction(result: dict[str, Any], expected_sender: str | None = None) -> None:
        tx = result.get("swap", result.get("transaction", result))
        if not isinstance(tx, dict): raise ValueError("Missing swap transaction")
        target, data = tx.get("to"), tx.get("data")
        if not isinstance(target, str) or not target.startswith("0x") or len(target) != 42:
            raise ValueError("Invalid transaction target")
        if not isinstance(data, str) or not data.startswith("0x") or len(data) <= 2:
            raise ValueError("Invalid transaction data")
        if int(tx.get("chainId", 42161)) != 42161:
            raise ValueError("Uniswap transaction must use Arbitrum mainnet")
        if expected_sender and str(tx.get("from", "")).lower() != expected_sender.lower():
            raise ValueError("Uniswap transaction sender does not match the strategy UA")
        value = tx.get("value", "0")
        if not isinstance(value, (str, int)):
            raise ValueError("Invalid transaction value")

    async def balance(self, account): raise NotImplementedError("Use chain RPC sidecar")
    async def positions(self, account): return []
    async def place(self, request, credential):
        if not self.live_enabled: raise RuntimeError("Uniswap broadcast circuit breaker is open")
        raise NotImplementedError("Signing and broadcast are delegated to the TypeScript sidecar")
    async def cancel(self, request, credential): raise NotImplementedError("AMM swaps cannot be cancelled after broadcast")
    async def close(self, request, credential): return await self.place(request, credential)
    async def reconcile(self, account): raise NotImplementedError("Use chain RPC sidecar")
    async def health(self):
        return VenueHealth(venue=self.name, healthy=True, live_submission_enabled=False,
                           reason="Scoped autonomous Uniswap signer is not configured")
