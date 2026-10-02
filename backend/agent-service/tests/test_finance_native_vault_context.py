"""A vault mandate names the Magic owner, not a Particle or executor wallet."""
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from moeazi_agent.finance_native_vault_contracts import VaultFinanceContext
from moeazi_agent.finance_native_vault_api import _vault_url


OWNER = "0x1234567890abcdef1234567890abcdef12345678"
VAULT = "0xabcdef1234567890abcdef1234567890abcdef12"
EXECUTOR = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"


def context(**changes):
    return {
        "financialAuthority": "identity_only", "customerSubject": "magic:alice",
        "strategyAccountId": "account-a", "assignmentId": "assignment-a",
        "programVersionId": "version-a", "venueAccountId": "venue-a",
        "mandateId": "mandate-a", "mandateHash": "11" * 32,
        "ownerAddress": OWNER, "vaultAddress": VAULT,
        "executorAddress": EXECUTOR, "vaultCodeHash": "0x" + "22" * 32,
        "programHash": "33" * 32, "policyHash": "44" * 32,
        "capitalUnits": "1000000", "maxBuyUnits": "500000",
        "expiresAt": int((datetime.now(timezone.utc) + timedelta(days=7)).timestamp()) * 1000,
        "sourceAccountId": f"arbitrum:42161:vault:{VAULT}",
        "venue": "uniswap", "policyJson": "{}",
    } | changes


def test_vault_context_keeps_three_addresses_distinct():
    value = VaultFinanceContext.model_validate(context())
    value.validate_identity(mandate_id="mandate-a", subject="magic:alice")
    assert value.sidecar_expectation()["ownerAddress"] == OWNER
    assert value.sidecar_expectation()["vaultAddress"] == VAULT
    assert value.sidecar_expectation()["executorAddress"] == EXECUTOR
    assert _vault_url("https://example.convex.site/worker", "context") == \
        "https://example.convex.site/native-vault-finance/context"


@pytest.mark.parametrize("change", [
    {"ownerAddress": VAULT}, {"executorAddress": OWNER},
    {"sourceAccountId": f"arbitrum:42161:wallet:{OWNER}"},
    {"maxBuyUnits": "2000000"}, {"financialAuthority": "live_approved"},
    {"mandateHash": "bad"},
])
def test_vault_context_rejects_ownership_or_cap_drift(change):
    with pytest.raises((ValidationError, ValueError)):
        value = VaultFinanceContext.model_validate(context(**change))
        value.validate_identity(mandate_id="mandate-a", subject="magic:alice")
