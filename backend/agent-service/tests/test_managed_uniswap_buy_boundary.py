"""Local, unfunded contract checks for the managed native buy boundary."""
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from moeazi_agent.contracts import ProtectiveExits, TradeProposal
from moeazi_agent.finance_contracts import FinanceError, FinanceScope
from moeazi_agent.managed_uniswap_buy_api import router
from moeazi_agent.managed_uniswap_buy_settlement import _operation_proof
from moeazi_agent.managed_uniswap_buy_state import proposal_amount_in


def proposal(**changes):
    body = dict(account_id="account-a", market="ETH-USDC", side="long",
        candidate_venues=["uniswap"], size_usd=12.345678, leverage=1.0,
        order_type="market", max_slippage_bps=50,
        protective_exits=ProtectiveExits(), evidence_ids=["evidence"],
        analysis_id="analysis-a", expires_at=datetime(2027, 1, 1, tzinfo=timezone.utc))
    return TradeProposal(**{**body, **changes})


def test_approved_amount_is_exact_native_usdc_and_narrow_direction():
    assert proposal_amount_in(proposal()) == "12345678"
    with pytest.raises(FinanceError):
        proposal_amount_in(proposal(size_usd=12.3456789))
    with pytest.raises(FinanceError):
        proposal_amount_in(proposal(side="short"))
    with pytest.raises(FinanceError):
        proposal_amount_in(proposal(market="BTC-USDC"))


def test_execute_route_requires_exact_worker_bearer_before_any_side_effect():
    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).post("/v1/finance/managed-program/execute-buy",
        json={"proposalId": "proposal-a", "commandId": "command-a"})
    assert response.status_code == 401


def test_finalized_native_proof_binds_attempt_quote_and_later_account_block():
    scope = FinanceScope(environment="live", scope_id="live",
                         strategy_account_id="account-a")
    block = "0x" + "a" * 64
    operation = {"state": "confirmed", "scope": "buy", "grantId": "grant-a",
        "intentId": "intent-a", "idempotencyKey": "client-a",
        "userOperationHash": "0x" + "b" * 64,
        "transactionHash": "0x" + "c" * 64,
        "confirmedBlockNumber": "123", "confirmedBlockHash": block,
        "actualInputUnits": "5000000", "actualOutputUnits": "2000000000000000"}
    reservation = {"reservation_id": "r" * 64, "attempt_id": "a" * 64,
        "intent_id": "intent-a", "client_id": "client-a",
        "normalized_payload_hash": "p" * 64, "snapshot_hash": "s" * 64}
    quote = type("Quote", (), {"amount_in": "5000000",
        "minimum_amount_out": "1900000000000000"})()
    snapshot = type("Snapshot", (), {"scope": scope, "source_block_number": "123",
        "source_block_hash": block, "snapshot_hash": "t" * 64})()
    body, digest = _operation_proof(operation, reservation, quote, snapshot)
    assert body["actualInputUnits"] == "5000000"
    assert len(digest) == 64
    snapshot.source_block_hash = "0x" + "d" * 64
    with pytest.raises(FinanceError):
        _operation_proof(operation, reservation, quote, snapshot)
