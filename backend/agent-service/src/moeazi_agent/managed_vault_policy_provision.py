"""Operator-reviewed live finance policy registration for a funded Magic vault.

Read reviewed JSON from stdin; no customer or model endpoint exposes this writer.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

import httpx
from pydantic import Field

from .config import get_settings
from .finance_contracts import FinanceError, FinanceScope, StrictFinanceModel, native_int
from .finance_native_activation_contracts import exact_pair_policy
from .finance_native_vault_api import _vault_url
from .finance_native_vault_contracts import VaultFinanceContext
from .finance_policy import SizingPolicy
from .finance_repository import FinanceRepository
from .managed_uniswap_policy_provision import _current_account
from .observation_contracts import InstrumentVersion
from .observation_storage import ObservationRepository


class VaultProvisionRequest(StrictFinanceModel):
    mandate_id: str = Field(alias="mandateId", min_length=1)
    subject: str = Field(min_length=1)
    expected_strategy_account_id: str = Field(alias="expectedStrategyAccountId", min_length=1)
    expected_program_version_id: str = Field(alias="expectedProgramVersionId", min_length=1)
    expected_owner_address: str = Field(alias="expectedOwnerAddress", min_length=42)
    expected_vault_address: str = Field(alias="expectedVaultAddress", min_length=42)
    maximum_daily_loss_usdc_units: str = Field(alias="maximumDailyLossUsdcUnits")
    instrument: InstrumentVersion
    finance_policy: SizingPolicy = Field(alias="financePolicy")


async def owned_context(settings, request: VaultProvisionRequest) -> VaultFinanceContext:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(_vault_url(settings.convex_worker_url, "context"),
            json={"mandateId": request.mandate_id},
            headers={"Authorization": "Bearer "
                     + settings.worker_shared_secret.get_secret_value()})
    if not response.is_success:
        raise FinanceError("owned funded Magic vault context is unavailable")
    context = VaultFinanceContext.model_validate(response.json())
    context.validate_identity(mandate_id=request.mandate_id, subject=request.subject)
    return context


def validate_provision(request: VaultProvisionRequest,
                       context: VaultFinanceContext) -> None:
    if (context.strategy_account_id != request.expected_strategy_account_id
            or context.program_version_id != request.expected_program_version_id
            or context.owner_address != request.expected_owner_address.lower()
            or context.vault_address != request.expected_vault_address.lower()
            or context.expires_at <= time.time_ns() // 1_000_000):
        raise FinanceError("operator review differs from the funded Magic vault")
    policy = request.finance_policy
    instrument = request.instrument
    if not exact_pair_policy(policy, instrument.model_dump(mode="json"),
                             instrument.registry_hash):
        raise FinanceError("finance policy is not the exact Arbitrum spot pair")
    loss = native_int(request.maximum_daily_loss_usdc_units, positive=True)
    capital = native_int(context.capital_units, positive=True)
    buy = native_int(context.max_buy_units, positive=True)
    if (loss > capital or buy > capital
            or native_int(policy.max_gross_notional_units, positive=True) > buy
            or native_int(policy.max_directional_notional_units, positive=True) > capital):
        raise FinanceError("reviewed finance policy exceeds committed vault capital")


async def provision(request: VaultProvisionRequest, *, apply: bool) -> dict:
    settings = get_settings()
    context = await owned_context(settings, request)
    validate_provision(request, context)
    scope = FinanceScope(environment="live", scope_id="live",
                         strategy_account_id=context.strategy_account_id)
    finance = FinanceRepository(settings.postgres_dsn)
    try:
        current = await _current_account(finance, scope)
        if current and (current["source_account_id"] not in
                        (None, context.source_account_id)
                        or current["admission_state"] == "open" and
                        (current["policy_version"] != request.finance_policy.policy_version
                         or current["policy_hash"] != request.finance_policy.policy_hash)):
            raise FinanceError("existing live finance account differs from this vault")
        result = {"status": "validated" if not apply else "registered",
                  "mandateId": request.mandate_id,
                  "strategyAccountId": context.strategy_account_id,
                  "programVersionId": context.program_version_id,
                  "ownerAddress": context.owner_address,
                  "vaultAddress": context.vault_address,
                  "instrumentVersionId": request.instrument.instrument_version_id,
                  "financePolicyVersion": request.finance_policy.policy_version,
                  "financePolicyHash": request.finance_policy.policy_hash,
                  "capitalUnits": context.capital_units,
                  "maxBuyUnits": context.max_buy_units,
                  "maximumDailyLossUsdcUnits": request.maximum_daily_loss_usdc_units}
        if apply:
            epoch = await finance.acquire_writer_epoch(scope,
                "native-uniswap-activation-v1")
            await ObservationRepository(finance.engine).register_instrument(
                request.instrument)
            await finance.register_policy(scope, epoch, request.finance_policy)
        return result
    finally:
        await finance.engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    options = parser.parse_args()
    try:
        request = VaultProvisionRequest.model_validate(json.load(sys.stdin))
        result = asyncio.run(provision(request, apply=options.apply))
    except Exception as error:
        print(json.dumps({"status": "blocked", "reason": str(error)}), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
