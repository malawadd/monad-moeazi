"""Finance-owned first Magic-vault buy: proposal to one native attempt and fill."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
from math import isfinite
import re

from .contracts import TradeProposal
from .finance_contracts import (
    FinanceError, FinanceScope, ReserveCommand, native_int,
    semantic_request_hash,
)
from .finance_uniswap_quote import (
    UniswapQuoteEvidenceRepository, UniswapV3Quote, quote_evidence_hash,
)
from .managed_uniswap_buy_api import _finance_context, _sidecar, _stored_quote
from .managed_uniswap_buy_state import (
    current_account, existing_trade, initial_buy_request, intent_id,
    proposal_amount_in,
)
from .managed_uniswap_buy_submission import (
    load_attempt_binding, mark_managed_submission_started,
)
from .managed_vault_buy_helpers import (
    recover_vault_buy, vault_order_input, vault_sidecar,
)
from .managed_vault_runtime_readiness import managed_vault_buy_enabled
from .policy import AutomationPolicy


_HASH = re.compile(r"^[0-9a-f]{64}$")
_ADDRESS = re.compile(r"^0x[0-9a-f]{40}$")


def _vault_identity(native: dict, scope: FinanceScope, context: dict) -> None:
    mandate = native.get("mandateId")
    if (not isinstance(mandate, str) or not mandate
            or native.get("executionGrantId") != "vault-" + mandate
            or not _ADDRESS.fullmatch(str(native.get("ownerAddress", "")))
            or not _ADDRESS.fullmatch(str(native.get("vaultAddress", "")))
            or not _ADDRESS.fullmatch(str(native.get("executorAddress", "")))
            or not re.fullmatch(r"0x[0-9a-f]{64}", str(native.get("vaultCodeHash", "")))
            or not _HASH.fullmatch(str(native.get("programHash", "")))
            or not _HASH.fullmatch(str(native.get("policyHash", "")))
            or native.get("programHash") != context["controllerRef"]["contentHash"]
            or native.get("ownerAddress") in {native.get("vaultAddress"),
                                               native.get("executorAddress")}
            or native_int(str(native.get("capitalUnits")), positive=True)
                < native_int(str(native.get("maxBuyUnits")), positive=True)
            or native_int(str(native.get("mandateExpiresAt")), positive=True) % 1000):
        raise FinanceError("Magic vault authority differs from the managed program")
    _ = scope


def _static_policy(context: dict, row: dict, proposal: TradeProposal,
                   native: dict) -> AutomationPolicy:
    policy = AutomationPolicy.from_convex({**context["policy"]["policy"],
        "version": context["policy"]["version"]})
    if policy.require_stop_loss or policy.require_take_profit:
        raise FinanceError("vault buy has no verified native protective exit")
    age = (datetime.now(timezone.utc).timestamp() * 1000 - int(row["createdAt"])) / 1000
    confidence, consensus = float(row["confidence"]), float(row["consensus"])
    if (not isfinite(confidence) or not isfinite(consensus) or consensus <= 0
            or confidence < policy.min_confidence
            or consensus < policy.min_consensus
            or proposal.market not in policy.markets
            or "uniswap" not in policy.venues
            or proposal.max_slippage_bps > policy.max_slippage_bps
            or proposal.leverage > policy.max_leverage
            or Decimal(str(proposal.size_usd)) > min(
                Decimal(str(policy.max_order_usd)),
                Decimal(str(policy.max_daily_volume_usd)),
                Decimal(str(policy.max_exposure_usd)))
            or age < 0 or age > policy.max_analysis_age_seconds
            or not proposal.evidence_ids
            or int(row["expiresAt"]) <= int(datetime.now(timezone.utc).timestamp() * 1000)
            or int(native["expiresAt"]) <= int(datetime.now(timezone.utc).timestamp() * 1000)
            or int(native["mandateExpiresAt"]) <= int(datetime.now(timezone.utc).timestamp() * 1000)
            or context["profile"].get("paused")
            or context["strategy"].get("emergencyStop")
            or context.get("availableCredits", 0) <= 0):
        raise FinanceError("managed vault proposal or frozen policy denied execution")
    return policy


async def execute_managed_vault_buy(finance, convex, settings, request, *,
        body, context: dict, row: dict, proposal: TradeProposal,
        scope: FinanceScope, controller, native: dict) -> dict:
    _vault_identity(native, scope, context)
    amount_in = proposal_amount_in(proposal)
    trade_intent = intent_id(scope, body.proposal_id)
    existing = await existing_trade(finance, scope, trade_intent)
    epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
    if existing and existing.get("attempt_id"):
        binding = await load_attempt_binding(finance, scope, trade_intent)
        if (not binding or binding["attempt_id"] != existing["attempt_id"]
                or binding["proposal_id"] != body.proposal_id
                or binding["command_id"] != body.command_id
                or binding["vault_address"] != native["vaultAddress"]):
            raise FinanceError("historical vault attempt differs from the proposal")
        quote = await _stored_quote(finance, existing, scope)
        return await recover_vault_buy(finance, settings, scope, context=context,
            reservation=existing, binding=binding, quote=quote)
    if not managed_vault_buy_enabled(settings, native["vaultAddress"]):
        raise FinanceError("managed vault live execution gates are closed")
    controls = await request.app.state.runtime_controls.get()
    if controls.manual_guard:
        raise FinanceError("manual guard blocks automatic vault execution")
    _static_policy(context, row, proposal, native)
    fingerprint = await _finance_context(convex, scope, controller)
    state = await current_account(finance, scope)
    if (state["source_account_id"] !=
            f"arbitrum:42161:vault:{native['vaultAddress']}"
            or state["observation_snapshot_hash"] != native["financeSnapshotHash"]
            or int(state["authority_epoch"]) != native_int(str(native["authorityEpoch"]))):
        raise FinanceError("vault finance source, snapshot or epoch changed")
    if existing is None:
        raw_quote = await _sidecar("scoped-quote", {"scope": "buy",
            "amountIn": amount_in, "slippageBps": proposal.max_slippage_bps})
        quote = UniswapV3Quote.model_validate(raw_quote)
        if quote.amount_in != amount_in:
            raise FinanceError("native vault quote differs from proposal amount")
        quote_hash = await UniswapQuoteEvidenceRepository(finance.engine).store_sidecar_quote(
            raw_quote, received_at=datetime.now(timezone.utc))
        policy, sizing = await initial_buy_request(finance, scope, state, quote, quote_hash)
        receipt = await finance.prepare_experiment_sizing_receipt(scope, epoch,
            int(state["revision"]), policy.policy_version, sizing)
        if (receipt["quantity_units"] != quote.minimum_amount_out
                or receipt["notional_units"] != quote.amount_in):
            raise FinanceError("vault financial sizing differs from exact quote")
        expires = min(datetime.fromtimestamp(int(row["expiresAt"]) / 1000, timezone.utc),
            datetime.fromtimestamp(int(native["expiresAt"]) / 1000, timezone.utc),
            datetime.fromtimestamp(int(native["mandateExpiresAt"]) / 1000, timezone.utc),
            datetime.now(timezone.utc) + timedelta(seconds=policy.max_reservation_seconds))
        command = ReserveCommand.model_construct(scope=scope, controller_ref=controller,
            controller_mode="autopilot", expected_revision=int(state["revision"]),
            writer_epoch=epoch, authority_epoch=int(state["authority_epoch"]),
            authority_fingerprint=fingerprint,
            idempotency_key="native-vault-buy:" + body.proposal_id,
            request_hash="0" * 64, intent_id=trade_intent, purpose="trade",
            policy_version=policy.policy_version, policy_hash=policy.policy_hash,
            snapshot_hash=state["observation_snapshot_hash"],
            calculation_receipt_hash=receipt["receipt_hash"],
            components=tuple(receipt["components"]), expires_at=expires)
        command = ReserveCommand.model_validate({**command.model_dump(mode="python"),
            "request_hash": semantic_request_hash("reserve", command)})
        hold = await finance.reserve_intent(command)
        existing = await existing_trade(finance, scope, trade_intent)
        if existing is None or existing["reservation_id"] != hold["reservationId"]:
            raise FinanceError("vault reservation identity is unavailable")
    else:
        quote = await _stored_quote(finance, existing, scope)
        if quote.amount_in != amount_in or existing["status"] != "reserved":
            raise FinanceError("existing vault buy cannot be submitted twice")
    deadline = min(int(existing["expires_at"].timestamp()),
                   int(datetime.now(timezone.utc).timestamp()) + 240,
                   int(native["mandateExpiresAt"]) // 1000 - 1)
    if deadline <= int(datetime.now(timezone.utc).timestamp()):
        raise FinanceError("vault buy reservation has expired")
    order_id = "0x" + sha256(("moeazi-vault-order-v1:" + trade_intent).encode()).hexdigest()
    native = {**native, "orderId": order_id}
    prepared = await _sidecar("managed-vault-prepare-buy",
        vault_order_input(native, quote, deadline))
    payload_hash = prepared.get("normalizedPayloadHash")
    if (prepared.get("orderId") != order_id or prepared.get("amountIn") != quote.amount_in
            or prepared.get("amountOutMinimum") != quote.minimum_amount_out
            or prepared.get("executorAddress") != native["executorAddress"]
            or not isinstance(payload_hash, str) or not _HASH.fullmatch(payload_hash)):
        raise FinanceError("vault preflight differs from reserved trade")
    state = await current_account(finance, scope)
    marker = await mark_managed_submission_started(finance, scope=scope,
        reservation_id=existing["reservation_id"], proposal_id=body.proposal_id,
        command_id=body.command_id, assignment_id=context["programAssignmentId"],
        program_version_id=context["programVersionId"],
        controller_ref=controller.model_dump(mode="json"),
        grant_id=native["executionGrantId"], owner_address=native["ownerAddress"],
        quote_hash=quote_evidence_hash(quote), amount_in=quote.amount_in,
        amount_out_minimum=quote.minimum_amount_out, deadline=deadline,
        normalized_payload_hash=payload_hash, writer_epoch=epoch,
        authority_epoch=int(state["authority_epoch"]),
        expected_revision=int(state["revision"]), vault_binding={
            "vaultAddress": native["vaultAddress"],
            "executorAddress": native["executorAddress"],
            "vaultCodeHash": native["vaultCodeHash"],
            "orderId": order_id, "fromBlock": prepared["finalizedBlockNumber"],
            "programHash": native["programHash"],
            "policyHash": native["policyHash"],
            "capitalUnits": native["capitalUnits"],
            "maxBuyUnits": native["maxBuyUnits"],
            "mandateExpiresAt": native["mandateExpiresAt"]})
    if marker.get("status") != "possible":
        raise FinanceError("vault possible-submission marker was not committed")
    await convex.command("transitionTradeProposal", proposalId=body.proposal_id,
                         status="executing")
    attempt = await finance.verify_possible_submission(scope, intent_id=trade_intent,
        client_id=body.command_id, normalized_payload_hash=payload_hash,
        venue_id="uniswap")
    if (not attempt or attempt["sourceAccountId"] !=
            f"arbitrum:42161:vault:{native['vaultAddress']}"
            or attempt["notionalUnits"] != quote.amount_in
            or attempt["quantityUnits"] != quote.minimum_amount_out):
        raise FinanceError("vault financial attempt is not valid for dispatch")
    claimed = await finance.claim_live_dispatch(scope,
        attempt_id=attempt["attemptId"],
        reservation_id=attempt["reservationId"],
        client_id=body.command_id, normalized_payload_hash=payload_hash,
        snapshot_hash=attempt["snapshotHash"], policy_hash=attempt["policyHash"],
        authority_epoch=attempt["authorityEpoch"])
    if not claimed:
        raise FinanceError("vault dispatch was already claimed or authority changed")
    try:
        await vault_sidecar(settings, "managed-vault-broadcast-buy",
            {**vault_order_input(native, quote, deadline),
             "normalizedPayloadHash": payload_hash}, private=True, timeout=45)
    except Exception:
        state = await current_account(finance, scope)
        await finance.mark_submission_uncertain(scope, existing["reservation_id"],
            epoch, int(state["revision"]), "native-vault-uncertain:" + trade_intent)
    binding = await load_attempt_binding(finance, scope, trade_intent)
    existing = await existing_trade(finance, scope, trade_intent)
    if not binding or not existing:
        raise FinanceError("vault attempt vanished after possible submission")
    return await recover_vault_buy(finance, settings, scope, context=context,
        reservation=existing, binding=binding, quote=quote)
