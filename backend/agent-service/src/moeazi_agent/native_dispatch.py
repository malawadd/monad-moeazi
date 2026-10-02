"""Narrow gateway-only Hyperliquid dispatch admission; never called by model code."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from hashlib import sha256
import json

from .contracts import ExecutionDecision, TradeProposal
from .finance_contracts import FinanceScope
from .gateway_credentials import GatewayCredentialClient


def native_payload_hash(strategy_account_id: str, venue_account_id: str,
                        target_address: str, order: dict) -> str:
    body = {"venue": "hyperliquid", "strategyAccountId": strategy_account_id,
            "venueAccountId": venue_account_id, "targetAddress": target_address,
            "order": order}
    normalized = json.dumps(body, sort_keys=True, separators=(",", ":"),
                            ensure_ascii=False, allow_nan=False)
    return sha256(("moeazi-native-order-v1\n" + normalized).encode()).hexdigest()


def _positive_limit(value: object, label: str) -> Decimal:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be an explicit decimal string")
    try:
        amount = Decimal(value)
    except InvalidOperation:
        raise ValueError(f"{label} is invalid") from None
    if not amount.is_finite() or amount <= 0:
        raise ValueError(f"{label} must be positive and finite")
    return amount


def _check_limits(limits_json: str, proposal: TradeProposal, expiry_ms: int) -> None:
    if expiry_ms <= int(datetime.now(timezone.utc).timestamp() * 1000):
        raise ValueError("Hyperliquid delegation has expired")
    try:
        limits = json.loads(limits_json)
    except (TypeError, ValueError):
        raise ValueError("Hyperliquid authority limits are malformed") from None
    if not isinstance(limits, dict):
        raise ValueError("Hyperliquid authority limits are malformed")
    max_order = _positive_limit(limits.get("maxOrderUsd"), "maxOrderUsd")
    _positive_limit(limits.get("maxCapitalUsd"), "maxCapitalUsd")
    _positive_limit(limits.get("maxDailyLossUsd"), "maxDailyLossUsd")
    if Decimal(str(proposal.size_usd)) > max_order:
        raise ValueError("proposal exceeds the scoped Hyperliquid order limit")


def _bind_financial_order(order: dict, proposal: TradeProposal,
                          attempt: dict, size: Decimal, price: Decimal) -> None:
    """Use persisted native instrument and sizing facts, never caller aliases."""
    instrument_id = attempt.get("instrumentVersionId")
    coin = attempt.get("nativeInstrumentId")
    kind = attempt.get("productKind")
    if not isinstance(instrument_id, str) or not instrument_id \
            or not isinstance(coin, str) or not coin or order.get("coin") != coin \
            or kind not in {"spot", "perpetual"}:
        raise ValueError("native order instrument differs from the reserved version")
    # The current proposal vocabulary is BTC-PERP for default perp and BTC/USDC
    # for spot. Only this exact, code-owned alias mapping is admitted.
    expected_market = f"{coin}-PERP" if kind == "perpetual" else coin
    if proposal.market != expected_market or order.get("market") != expected_market:
        raise ValueError("proposal market differs from the reserved native instrument")
    is_spot_coin = coin.startswith("@") or "/" in coin
    if (kind == "spot") != is_spot_coin:
        raise ValueError("native order product kind differs from its venue coin")
    action = attempt.get("action")
    if action != ({"spot": "spot_buy" if proposal.side == "long" else "spot_sell",
                   "perpetual": "perp_open"}[kind]) or order.get("reduce_only", False) is not False \
            or "cloid" in order:
        raise ValueError("native order action differs from reserved financial action")
    try:
        base_scale = 10 ** int(attempt["baseDecimals"])
        quote_scale = 10 ** int(attempt["quoteDecimals"])
        reserved_size = Fraction(int(attempt["quantityUnits"]), base_scale)
        reserved_notional = Fraction(int(attempt["notionalUnits"]), quote_scale)
        reserved_price = Fraction(int(attempt["priceNumerator"]) * base_scale,
                                  int(attempt["priceDenominator"]) * quote_scale)
    except (KeyError, TypeError, ValueError, InvalidOperation, ZeroDivisionError):
        raise ValueError("reserved native sizing facts are unavailable") from None
    if base_scale <= 0 or quote_scale <= 0 or Fraction(size) > reserved_size \
            or Fraction(price) != reserved_price \
            or Fraction(size) * Fraction(price) > reserved_notional:
        raise ValueError("native order exceeds or differs from its reserved sizing receipt")


async def dispatch_hyperliquid_native(*, proposal: TradeProposal,
                                      decision: ExecutionDecision, idempotency_key: str,
                                      venue_account_id: str, target_address: str,
                                      native_order: dict, intent_id: str,
                                      client_id: str, payload_hash: str,
                                      finance, gateway, settings) -> dict:
    if decision.result != "pass" or decision.idempotency_key != idempotency_key:
        raise ValueError("native order has no matching passed policy decision")
    if proposal.expires_at <= datetime.now(timezone.utc) or "hyperliquid" not in proposal.candidate_venues:
        raise ValueError("native proposal is expired or excludes Hyperliquid")
    if intent_id != idempotency_key:
        raise ValueError("native financial intent differs from the approved order identity")
    if not isinstance(native_order, dict) or native_order.get("idempotency_key") != idempotency_key \
            or native_order.get("market") != proposal.market \
            or native_order.get("side") != ("buy" if proposal.side == "long" else "sell"):
        raise ValueError("native order differs from the approved proposal")
    if proposal.order_type != "limit" or proposal.limit_price is None:
        raise ValueError("native Hyperliquid dispatch currently requires a limit proposal")
    size = _positive_limit(native_order.get("size"), "native order size")
    price = _positive_limit(native_order.get("price"), "native order price")
    if price != Decimal(str(proposal.limit_price)) or size * price > Decimal(str(proposal.size_usd)):
        raise ValueError("native order exceeds the approved price or notional")
    if any(key in native_order for key in (
            "account", "accountAddress", "account_address", "accountScope",
            "account_scope", "scope", "targetAddress", "target_address",
            "masterAddress", "master_address", "targetKind", "target_kind")):
        raise ValueError("native order cannot supply its own account scope")
    expected_hash = native_payload_hash(proposal.account_id, venue_account_id,
                                        target_address, native_order)
    if payload_hash != expected_hash or client_id != idempotency_key:
        raise ValueError("native order does not match its durable submission identity")
    scope = FinanceScope(environment="live", scope_id="live",
                         strategy_account_id=proposal.account_id)
    attempt = await finance.verify_possible_submission(scope, intent_id=intent_id,
        client_id=client_id, normalized_payload_hash=payload_hash)
    if not attempt:
        raise ValueError("durable live financial submission authority is unavailable")
    _bind_financial_order(native_order, proposal, attempt, size, price)
    credential = await GatewayCredentialClient(
        settings.convex_gateway_credential_url,
        settings.gateway_credential_secret.get_secret_value(),
    ).hyperliquid(proposal.account_id, venue_account_id, target_address)
    _check_limits(credential.limitsJson, proposal, credential.permissionExpiresAt)
    if credential.kmsKeyRef != "local-master" or settings.environment not in {"local", "test"}:
        raise ValueError("Hyperliquid credential unwrap backend is unavailable")
    claimed = await finance.claim_live_dispatch(
        scope, attempt_id=attempt["attemptId"],
        reservation_id=attempt["reservationId"], client_id=client_id,
        normalized_payload_hash=payload_hash,
        snapshot_hash=attempt["snapshotHash"],
        policy_hash=attempt["policyHash"],
        authority_epoch=attempt["authorityEpoch"],
    )
    if not claimed:
        raise ValueError("live submission was claimed or its financial authority changed")
    order = {**native_order, "target_address": credential.targetAddress,
             "master_address": credential.masterAddress, "target_kind": credential.targetKind}
    return await gateway.execute("hyperliquid", order, decision,
                                 credential.encryptedEnvelope,
                                 credential.credentialContext)
