"""Local operator provisioning for one explicitly owned internal Uniswap account.

Read one reviewed JSON request from stdin. No HTTP route exposes this writer.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

import httpx
from pydantic import Field
from sqlalchemy import text

from .config import get_settings
from .finance_contracts import FinanceError, FinanceScope, StrictFinanceModel, native_int
from .finance_native_activation_api import _activation_url
from .finance_native_activation_contracts import (
    ActivationContext, exact_grant_limits, exact_pair_policy, normal_address,
)
from .finance_policy import SizingPolicy
from .finance_repository import FinanceRepository
from .observation_contracts import InstrumentVersion
from .observation_storage import ObservationRepository


PREFLIGHT_GRANT_ID = "operator-preflight"


class ProvisionRequest(StrictFinanceModel):
    assignment_id: str = Field(alias="assignmentId", min_length=1, max_length=160)
    subject: str = Field(min_length=1, max_length=512)
    expected_strategy_account_id: str = Field(alias="expectedStrategyAccountId", min_length=1)
    expected_program_version_id: str = Field(alias="expectedProgramVersionId", min_length=1)
    expected_owner_address: str = Field(alias="expectedOwnerAddress", min_length=42)
    maximum_capital_usdc_units: str = Field(alias="maximumCapitalUsdcUnits")
    maximum_single_order_usdc_units: str = Field(alias="maximumSingleOrderUsdcUnits")
    maximum_daily_loss_usdc_units: str = Field(alias="maximumDailyLossUsdcUnits")
    authority_expires_at: int = Field(alias="authorityExpiresAt", gt=0)
    instrument: InstrumentVersion
    finance_policy: SizingPolicy = Field(alias="financePolicy")


async def owned_context(settings, request: ProvisionRequest) -> ActivationContext:
    url = _activation_url(settings.convex_worker_url, "context")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(url, json={
            "assignmentId": request.assignment_id,
            "executionGrantId": PREFLIGHT_GRANT_ID,
        }, headers={"Authorization": "Bearer "
                    + settings.worker_shared_secret.get_secret_value()})
    if not response.is_success:
        raise FinanceError("owned internal program context is unavailable")
    return ActivationContext.model_validate(response.json())


def validate_provision(request: ProvisionRequest, context: ActivationContext) -> dict[str, str]:
    if (context.financial_authority != "identity_only"
            or context.execution_grant_id != PREFLIGHT_GRANT_ID
            or context.assignment_id != request.assignment_id
            or context.customer_subject != request.subject
            or context.strategy_account_id != request.expected_strategy_account_id
            or context.program_version_id != request.expected_program_version_id
            or normal_address(context.owner_address)
                != normal_address(request.expected_owner_address)
            or context.venue != "uniswap"
            or context.source_account_id != "arbitrum:42161:wallet:"
                + normal_address(context.owner_address)
            or context.authority_expires_at <= int(time.time() * 1000)
            or context.authority_expires_at != request.authority_expires_at):
        raise FinanceError("operator provision does not match owned frozen program")
    policy = request.finance_policy
    instrument = request.instrument
    if not exact_pair_policy(policy, instrument.model_dump(mode="json"),
                             instrument.registry_hash):
        raise FinanceError("finance policy is not for the exact Arbitrum Uniswap pair")
    limits = exact_grant_limits(context)
    capital = native_int(request.maximum_capital_usdc_units, positive=True)
    single_order = native_int(request.maximum_single_order_usdc_units, positive=True)
    daily_loss = native_int(request.maximum_daily_loss_usdc_units, positive=True)
    if (native_int(policy.max_quantity_units, positive=True)
            > native_int(limits["maxWethUnits"], positive=True)
            or native_int(policy.max_gross_notional_units, positive=True)
                > native_int(limits["maxUsdcUnits"], positive=True)
            or native_int(policy.max_directional_notional_units, positive=True)
                > native_int(limits["maxUsdcUnits"], positive=True)
            or native_int(limits["maxUsdcUnits"], positive=True) > capital
            or native_int(policy.max_gross_notional_units, positive=True) > single_order
            or single_order > daily_loss or daily_loss > capital):
        raise FinanceError("live finance policy exceeds frozen venue or operator envelope")
    return limits


async def _current_account(finance: FinanceRepository, scope: FinanceScope) -> dict | None:
    async with finance.engine.connect() as connection:
        row = (await connection.execute(text("""
          SELECT source_account_id,admission_state,policy_version,policy_hash
          FROM finance_accounts WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account
        """), {"account": scope.strategy_account_id})).mappings().first()
    return dict(row) if row else None


async def provision(request: ProvisionRequest, *, apply: bool) -> dict:
    settings = get_settings()
    context = await owned_context(settings, request)
    limits = validate_provision(request, context)
    scope = FinanceScope(environment="live", scope_id="live",
                         strategy_account_id=context.strategy_account_id)
    finance = FinanceRepository(settings.postgres_dsn)
    try:
        current = await _current_account(finance, scope)
        if current and (current["source_account_id"] not in
                        (None, context.source_account_id)
                        or current["admission_state"] == "open"
                        and (current["policy_version"] != request.finance_policy.policy_version
                             or current["policy_hash"] != request.finance_policy.policy_hash)):
            raise FinanceError("existing live account differs from this owner or policy")
        result = {"status": "validated" if not apply else "registered",
                  "strategyAccountId": scope.strategy_account_id,
                  "assignmentId": request.assignment_id,
                  "programVersionId": context.program_version_id,
                  "ownerAddress": context.owner_address,
                  "instrumentVersionId": request.instrument.instrument_version_id,
                  "instrumentRegistryHash": request.instrument.registry_hash,
                  "financePolicyVersion": request.finance_policy.policy_version,
                  "financePolicyHash": request.finance_policy.policy_hash,
                  "maximumCapitalUsdcUnits": request.maximum_capital_usdc_units,
                  "maximumSingleOrderUsdcUnits": request.maximum_single_order_usdc_units,
                  "maximumDailyLossUsdcUnits": request.maximum_daily_loss_usdc_units,
                  "authorityExpiresAt": request.authority_expires_at,
                  "maxUsdcUnits": limits["maxUsdcUnits"],
                  "maxWethUnits": limits["maxWethUnits"]}
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
    parser.add_argument("--apply", action="store_true",
                        help="Register the reviewed instrument and live policy")
    options = parser.parse_args()
    try:
        request = ProvisionRequest.model_validate(json.load(sys.stdin))
        outcome = asyncio.run(provision(request, apply=options.apply))
    except Exception as error:
        print(json.dumps({"status": "blocked", "reason": str(error)}), file=sys.stderr)
        return 1
    print(json.dumps(outcome, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
