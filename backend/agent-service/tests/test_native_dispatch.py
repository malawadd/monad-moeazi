import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from moeazi_agent.contracts import ExecutionDecision, TradeProposal
from moeazi_agent.gateway_credentials import HyperliquidCredentialScope
from moeazi_agent.native_dispatch import (
    _bind_financial_order, dispatch_hyperliquid_native, native_payload_hash,
)


TARGET = "0x" + "3" * 40
MASTER = "0x" + "1" * 40
AGENT = "0x" + "2" * 40


def values():
    proposal = TradeProposal.model_validate({
        "account_id": "account-a", "market": "BTC-PERP", "side": "long",
        "candidate_venues": ["hyperliquid"], "size_usd": 5,
        "leverage": 1, "order_type": "limit", "limit_price": 100,
        "max_slippage_bps": 50, "protective_exits": {"stop_loss": 95,
        "take_profit": 110}, "evidence_ids": ["evidence-a"],
        "analysis_id": "analysis-a", "expires_at": datetime.now(timezone.utc) + timedelta(minutes=1),
    })
    decision = ExecutionDecision(policy_version=1, checks=[], quote_reference="quote-a",
        idempotency_key="order-a", result="pass")
    order = {"coin": "BTC", "market": "BTC-PERP", "side": "buy", "size": "0.05",
             "price": "100", "idempotency_key": "order-a"}
    args = dict(proposal=proposal, decision=decision, idempotency_key="order-a",
        venue_account_id="venue-a", target_address=TARGET, native_order=order,
        intent_id="order-a", client_id="order-a",
        payload_hash=native_payload_hash("account-a", "venue-a", TARGET, order))
    return args


class Finance:
    def __init__(self, permit=False, claim=True):
        self.permit = permit; self.claim = claim; self.calls = 0
        self.claim_calls = 0
    async def verify_possible_submission(self, scope, **kwargs):
        self.calls += 1
        assert scope.strategy_account_id == "account-a"
        return {"attemptId": "attempt-a", "reservationId": "reservation-a",
                "snapshotHash": "a" * 64, "policyHash": "b" * 64,
                "authorityEpoch": 1, "instrumentVersionId": "BTC-PERP",
                "nativeInstrumentId": "BTC", "productKind": "perpetual",
                "action": "perp_open", "baseDecimals": 8, "quoteDecimals": 6,
                "quantityUnits": "5000000", "notionalUnits": "5000000",
                "priceNumerator": "1", "priceDenominator": "1"} if self.permit else None

    async def claim_live_dispatch(self, scope, **kwargs):
        self.claim_calls += 1
        assert kwargs["attempt_id"] == "attempt-a"
        assert kwargs["reservation_id"] == "reservation-a"
        assert kwargs["client_id"] == "order-a"
        assert kwargs["authority_epoch"] == 1
        return self.claim


class Gateway:
    def __init__(self): self.calls = []
    async def execute(self, *args):
        self.calls.append(args)
        return {"state": "submitted"}


def settings():
    return SimpleNamespace(convex_gateway_credential_url="https://example.convex.site/credential",
        gateway_credential_secret=SecretStr("s" * 32), environment="local")


def test_native_dispatch_requires_durable_finance_before_credential(monkeypatch):
    async def forbidden(*_args): raise AssertionError("credential was requested before finance admission")
    monkeypatch.setattr("moeazi_agent.native_dispatch.GatewayCredentialClient.hyperliquid", forbidden)
    finance, gateway = Finance(), Gateway()
    with pytest.raises(ValueError, match="durable live financial"):
        asyncio.run(dispatch_hyperliquid_native(**values(), finance=finance,
            gateway=gateway, settings=settings()))
    assert finance.calls == 1
    assert gateway.calls == []


def test_native_dispatch_binds_order_scope_limits_and_finance(monkeypatch):
    credential = HyperliquidCredentialScope.model_validate({
        "strategyAccountId": "account-a", "venueAccountId": "venue-a",
        "targetAddress": TARGET, "masterAddress": MASTER, "targetKind": "subaccount",
        "apiWalletAddress": AGENT, "encryptedEnvelope": "opaque",
        "kmsKeyRef": "local-master", "keyVersion": 1,
        "credentialContext": f"venue-credential:v1:account-a:hyperliquid:{AGENT}",
        "permissionExpiresAt": 4_000_000_000_000,
        "limitsJson": '{"maxOrderUsd":"5","maxCapitalUsd":"10","maxDailyLossUsd":"1"}',
    })
    async def fetch(_self, *_args): return credential
    monkeypatch.setattr("moeazi_agent.native_dispatch.GatewayCredentialClient.hyperliquid", fetch)
    finance, gateway = Finance(permit=True), Gateway()
    result = asyncio.run(dispatch_hyperliquid_native(**values(), finance=finance,
        gateway=gateway, settings=settings()))
    assert result == {"state": "submitted"}
    assert gateway.calls[0][1]["target_address"] == TARGET
    assert gateway.calls[0][1]["master_address"] == MASTER
    assert gateway.calls[0][3] == "opaque"
    assert finance.claim_calls == 1


def test_native_dispatch_never_submits_when_one_shot_claim_is_consumed(monkeypatch):
    credential = HyperliquidCredentialScope.model_validate({
        "strategyAccountId": "account-a", "venueAccountId": "venue-a",
        "targetAddress": TARGET, "masterAddress": MASTER, "targetKind": "subaccount",
        "apiWalletAddress": AGENT, "encryptedEnvelope": "opaque",
        "kmsKeyRef": "local-master", "keyVersion": 1,
        "credentialContext": f"venue-credential:v1:account-a:hyperliquid:{AGENT}",
        "permissionExpiresAt": 4_000_000_000_000,
        "limitsJson": '{"maxOrderUsd":"5","maxCapitalUsd":"10","maxDailyLossUsd":"1"}',
    })
    async def fetch(_self, *_args): return credential
    monkeypatch.setattr("moeazi_agent.native_dispatch.GatewayCredentialClient.hyperliquid", fetch)
    finance, gateway = Finance(permit=True, claim=False), Gateway()
    with pytest.raises(ValueError, match="claimed"):
        asyncio.run(dispatch_hyperliquid_native(**values(), finance=finance,
            gateway=gateway, settings=settings()))
    assert finance.claim_calls == 1
    assert gateway.calls == []


def test_native_dispatch_rejects_unbound_order_before_finance():
    args = values()
    args["native_order"]["side"] = "sell"
    finance, gateway = Finance(permit=True), Gateway()
    with pytest.raises(ValueError, match="differs"):
        asyncio.run(dispatch_hyperliquid_native(**args, finance=finance,
            gateway=gateway, settings=settings()))
    assert finance.calls == 0


@pytest.mark.parametrize("change", [
    {"coin": "ETH"}, {"size": "0.06"}, {"price": "101"},
    {"market": "ETH-PERP"}, {"reduce_only": True},
    {"cloid": "0x" + "a" * 32},
])
def test_native_dispatch_rejects_order_outside_reserved_instrument_or_size(change):
    args = values()
    args["native_order"].update(change)
    args["payload_hash"] = native_payload_hash(
        "account-a", "venue-a", TARGET, args["native_order"])
    finance, gateway = Finance(permit=True), Gateway()
    with pytest.raises(ValueError):
        asyncio.run(dispatch_hyperliquid_native(**args, finance=finance,
            gateway=gateway, settings=settings()))
    assert gateway.calls == []


def test_spot_order_requires_exact_registered_coin_and_spot_sizing():
    proposal = values()["proposal"].model_copy(update={"market": "BTC/USDC"})
    attempt = {"instrumentVersionId": "hl:BTC/USDC:v1",
               "nativeInstrumentId": "BTC/USDC", "productKind": "spot",
               "action": "spot_buy", "baseDecimals": 8, "quoteDecimals": 6,
               "quantityUnits": "5000000", "notionalUnits": "5000000",
               "priceNumerator": "1", "priceDenominator": "1"}
    order = {"market": proposal.market, "coin": "BTC/USDC"}
    _bind_financial_order(order, proposal, attempt,
                          size=Decimal("0.05"), price=Decimal("100"))
    with pytest.raises(ValueError, match="instrument"):
        _bind_financial_order({**order, "coin": "ETH/USDC"}, proposal, attempt,
                              size=Decimal("0.05"), price=Decimal("100"))
