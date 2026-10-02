import pytest
from pydantic import ValidationError

from moeazi_agent.routing_contracts import SwapApprovalRequest, SwapQuoteRequest


ADDRESS_A = "0x" + "1" * 40
ADDRESS_B = "0x" + "2" * 40


def test_quote_contract_requires_arbitrum_string_chain_ids():
    request = SwapQuoteRequest(
        token_in=ADDRESS_A,
        token_out=ADDRESS_B,
        amount="1000000",
        token_in_chain_id="42161",
        token_out_chain_id="42161",
        swapper=ADDRESS_A,
    )
    assert request.token_in_chain_id == "42161"
    with pytest.raises(ValidationError, match="Arbitrum"):
        SwapQuoteRequest(
            token_in=ADDRESS_A,
            token_out=ADDRESS_B,
            amount="1000000",
            token_in_chain_id="10",
            token_out_chain_id="10",
            swapper=ADDRESS_A,
        )


def test_approval_contract_rejects_non_arbitrum_chain():
    with pytest.raises(ValidationError, match="Arbitrum"):
        SwapApprovalRequest(wallet_address=ADDRESS_A, token=ADDRESS_B, amount="1", chain_id=1)
