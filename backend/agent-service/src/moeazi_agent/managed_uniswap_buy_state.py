"""Read-only, exact inputs for the first managed Arbitrum USDC-to-WETH buy."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from hashlib import sha256

from sqlalchemy import text

from .account_observation_storage import AccountObservationRepository
from .contracts import TradeProposal
from .controller_contracts import ControllerRef
from .finance_contracts import FinanceError, FinanceScope, db_native_int, native_int
from .finance_native_activation_api import _registered_policy
from .finance_observation_contracts import (
    ARBITRUM_MANAGED_PAIR_COVERAGE, ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID,
)
from .finance_policy import SizingRequest
from .finance_uniswap_quote import UniswapV3Quote


def proposal_amount_in(proposal: TradeProposal) -> str:
    """Require an exact USDC-six-decimal proposal amount; never round a float."""
    if proposal.side != "long" or proposal.candidate_venues != ["uniswap"] \
            or proposal.order_type != "market" or proposal.leverage != 1 \
            or proposal.market.upper() not in {"WETH-USDC", "ETH-USDC", "ETH/USDC", "WETH/USDC"} \
            or not 1 <= proposal.max_slippage_bps <= 500:
        raise FinanceError("only one unlevered managed Uniswap market buy is supported")
    try:
        native = Decimal(str(proposal.size_usd)) * 1_000_000
    except (InvalidOperation, ValueError) as exc:
        raise FinanceError("proposal USDC amount is invalid") from exc
    if not native.is_finite() or native != native.to_integral_value():
        raise FinanceError("proposal amount must be exact USDC native units")
    value = str(int(native))
    native_int(value, positive=True)
    return value


def managed_identity(context: dict, row: dict, proposal: TradeProposal,
                     command_id: str) -> tuple[FinanceScope, ControllerRef, dict]:
    if not command_id or command_id != row.get("idempotencyKey"):
        raise FinanceError("execution command differs from proposal idempotency identity")
    if row.get("status") not in {"approved", "executing"} \
            or row.get("controllerMode") != "autopilot":
        raise FinanceError("proposal is not approved for managed execution")
    controller = ControllerRef.model_validate(row["controllerRef"])
    native = context.get("nativeAuthority")
    if controller.controllerKind != "managed_program" or controller.environment != "live" \
            or controller.strategyAccountId != row.get("strategyAccountId") \
            or controller != ControllerRef.model_validate(context["controllerRef"]) \
            or not isinstance(native, dict) or native.get("venue") != "uniswap" \
            or native.get("executionGrantId") is None \
            or native.get("financeSnapshotHash") is None \
            or context.get("programAssignmentId") != row.get("programAssignmentId") \
            or context.get("programVersionId") != row.get("programVersionId") \
            or proposal.account_id != row.get("strategyAccountId"):
        raise FinanceError("managed proposal identity or native grant is unavailable")
    scope = FinanceScope(environment="live", scope_id="live",
                         strategy_account_id=controller.strategyAccountId)
    return scope, controller, native


def intent_id(scope: FinanceScope, proposal_id: str) -> str:
    return sha256(("moeazi-managed-uniswap-buy-v1:" + scope.strategy_account_id
                   + ":" + proposal_id).encode()).hexdigest()


async def current_account(finance, scope: FinanceScope) -> dict:
    async with finance.engine.connect() as conn:
        row = (await conn.execute(text("""
          SELECT revision,source_account_id,policy_version,policy_hash,admission_state,
                 reconciliation_state,observation_snapshot_hash,authority_epoch,writer_epoch
          FROM finance_accounts WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account
        """), {"account": scope.strategy_account_id})).mappings().first()
    if row is None:
        raise FinanceError("native financial account is unavailable")
    return dict(row)


async def existing_trade(finance, scope: FinanceScope, trade_intent_id: str) -> dict | None:
    async with finance.engine.connect() as conn:
        rows = (await conn.execute(text("""
          SELECT r.*,a.attempt_id,a.client_id,a.normalized_payload_hash
          FROM finance_reservations r LEFT JOIN finance_submission_attempts a
            ON a.environment=r.environment AND a.scope_id=r.scope_id
           AND a.strategy_account_id=r.strategy_account_id
           AND a.reservation_id=r.reservation_id
          WHERE r.environment='live' AND r.scope_id='live'
            AND r.strategy_account_id=:account AND r.intent_id=:intent
        """), {"account": scope.strategy_account_id,
               "intent": trade_intent_id})).mappings().all()
    if len(rows) > 1:
        raise FinanceError("proposal already has multiple financial reservations")
    return dict(rows[0]) if rows else None


async def initial_buy_request(finance, scope: FinanceScope, account: dict,
                              quote: UniswapV3Quote, quote_hash: str):
    """Prove the deliberately narrow first-buy zero-exposure condition from SQL."""
    if account["admission_state"] != "open" or account["reconciliation_state"] != "clean" \
            or not account["observation_snapshot_hash"] or not account["source_account_id"]:
        raise FinanceError("managed pair is not clean and admitted")
    snapshot = await AccountObservationRepository(finance.engine).load_by_hash(
        account["observation_snapshot_hash"])
    if snapshot is None or snapshot.scope != scope \
            or snapshot.coverage_scope != ARBITRUM_MANAGED_PAIR_COVERAGE \
            or snapshot.source_account_id != account["source_account_id"]:
        raise FinanceError("managed pair snapshot identity is unavailable")
    registered = {(row.asset_unit_id, row.location_id, row.book): row.registry_hash
                  for row in snapshot.observed_balances}
    base = ARBITRUM_WETH_UNIT_ID
    usdc = ARBITRUM_USDC_UNIT_ID
    location = snapshot.source_account_id
    base_registry = registered.get((base, location, "wallet"))
    quote_registry = registered.get((usdc, location, "wallet"))
    if not base_registry or not quote_registry:
        raise FinanceError("exact pair registrations are unavailable")
    async with finance.engine.connect() as conn:
        balances = (await conn.execute(text("""
          SELECT asset_unit_id,location_id,book,units FROM finance_balances
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
        """), {"account": scope.strategy_account_id})).mappings().all()
        active = (await conn.execute(text("""
          SELECT 1 FROM finance_reservations WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account AND purpose='trade'
            AND status IN ('reserved','submitted','uncertain') LIMIT 1
        """), {"account": scope.strategy_account_id})).first()
        positions = (await conn.execute(text("""
          SELECT 1 FROM finance_positions WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account LIMIT 1
        """), {"account": scope.strategy_account_id})).first()
        prior_economic_event = (await conn.execute(text("""
          SELECT 1 FROM finance_source_events WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account AND event_kind<>'opening' LIMIT 1
        """), {"account": scope.strategy_account_id})).first()
    if active or positions or prior_economic_event or any(db_native_int(row["units"]) != 0 and (
            row["asset_unit_id"] == base or row["book"] != "wallet" or
            row["asset_unit_id"] not in {base, usdc} or row["location_id"] != location)
            for row in balances):
        raise FinanceError("first managed buy requires no existing or pending exposure")
    policy = await _registered_policy(finance, scope, account["policy_version"],
                                      account["policy_hash"])
    numerator, denominator = quote.quote_per_raw_base_unit
    request = SizingRequest(action="spot_buy", instrument_version_id=policy.instrument_version_id,
        desired_quantity_units=quote.minimum_amount_out, quantity_asset_unit_id=base,
        quantity_registry_hash=base_registry, quote_asset_unit_id=usdc,
        quote_registry_hash=quote_registry, location_id=location,
        quote_per_quantity_numerator=str(numerator),
        quote_per_quantity_denominator=str(denominator),
        price_snapshot_hash=quote_hash, account_snapshot_hash=snapshot.snapshot_hash,
        existing_gross_notional_units="0", existing_directional_notional_units="0")
    return policy, request
