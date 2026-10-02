"""Authenticated route for the finance-owned managed buy lane."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from hmac import compare_digest
from math import isfinite

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import Field

from .config import get_settings
from .contracts import TradeProposal
from .convex import ConvexWorkerClient
from .execution_controller import require_executable_controller
from .finance_contracts import FinanceError, FinanceScope, ReserveCommand, StrictFinanceModel, native_int, semantic_request_hash
from .finance_policy import SizingReceipt
from .finance_uniswap_quote import UniswapQuoteEvidenceRepository, UniswapV3Quote, quote_evidence_hash
from .managed_uniswap_buy_submission import load_attempt_binding, mark_managed_submission_started
from .managed_uniswap_buy_state import current_account, existing_trade, initial_buy_request, intent_id, managed_identity, proposal_amount_in
from .managed_uniswap_buy_api import _block, _sidecar, _readiness, _finance_context, _broadcast_input, _reconcile_context, _recover_existing, _stored_quote, _reconcile_or_pending
from .managed_vault_buy_flow import execute_managed_vault_buy
from .policy import AutomationPolicy

router = APIRouter(prefix="/v1/finance/managed-program", tags=["managed finance execution"])

class ExecuteBuyRequest(StrictFinanceModel):
    proposal_id: str = Field(alias="proposalId", min_length=1, max_length=256)
    command_id: str = Field(alias="commandId", min_length=1, max_length=256)

@router.post("/execute-buy")
async def execute_managed_buy(body: ExecuteBuyRequest, request: Request,
        authorization: str | None = Header(default=None)):
    settings = get_settings()
    expected = "Bearer " + settings.worker_shared_secret.get_secret_value()
    if not authorization or not compare_digest(authorization.encode(), expected.encode()):
        _block("authenticated_worker_required", 401)
    finance = getattr(request.app.state, "finance", None)
    if finance is None:
        _block("financial_writer_unavailable", 503)
    convex = ConvexWorkerClient(settings)
    try:
        context = await convex.command("getTradeProposalExecutionContext",
                                      proposalId=body.proposal_id)
        if not isinstance(context, dict) or not context.get("nativeAuthority") \
                or context.get("proposal", {}).get("status") == "executing":
            recovery = await _reconcile_context(settings, body.proposal_id, body.command_id)
            return await _recover_existing(finance, convex, settings,
                body.proposal_id, body.command_id, recovery)
        row = context["proposal"]
        proposal = TradeProposal.model_validate(row["payload"])
        require_executable_controller(row, context)
        scope, controller, native = managed_identity(context, row, proposal, body.command_id)
        if native.get("mandateId"):
            return await execute_managed_vault_buy(finance, convex, settings, request,
                body=body, context=context, row=row, proposal=proposal,
                scope=scope, controller=controller, native=native)
        amount_in = proposal_amount_in(proposal)
        trade_intent = intent_id(scope, body.proposal_id)
        existing = await existing_trade(finance, scope, trade_intent)
        epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
        if existing is not None and existing.get("attempt_id"):
            binding = await load_attempt_binding(finance, scope, trade_intent)
            if not binding or binding["attempt_id"] != existing["attempt_id"] \
                    or binding["proposal_id"] != body.proposal_id \
                    or binding["command_id"] != body.command_id \
                    or binding["assignment_id"] != context["programAssignmentId"] \
                    or binding["program_version_id"] != context["programVersionId"] \
                    or binding["controller_ref"] != controller.model_dump(mode="json"):
                raise FinanceError("managed attempt binding differs from current proposal")
            native = {"executionGrantId": binding["grant_id"],
                      "ownerAddress": binding["owner_address"]}
            quote = await _stored_quote(finance, existing, scope)
            return await _reconcile_or_pending(finance, convex, settings, scope, native,
                context, row, existing, quote, trade_intent, body.command_id, epoch)
        if not settings.live_execution_enabled or "uniswap" not in settings.certified_venue_set:
            _block("live_uniswap_execution_gate_closed")
        policy = AutomationPolicy.from_convex({**context["policy"]["policy"],
            "version": context["policy"]["version"]})
        if policy.require_stop_loss or policy.require_take_profit:
            _block("managed_buy_has_no_native_protective_exit")
        age = (datetime.now(timezone.utc).timestamp() * 1000 - int(row["createdAt"])) / 1000
        confidence = float(row["confidence"])
        consensus = float(row["consensus"])
        if not isfinite(confidence) or not isfinite(consensus) \
                or consensus <= 0 or confidence < policy.min_confidence \
                or consensus < policy.min_consensus \
                or proposal.market not in policy.markets or "uniswap" not in policy.venues \
                or proposal.max_slippage_bps > policy.max_slippage_bps \
                or proposal.leverage > policy.max_leverage \
                or Decimal(str(proposal.size_usd)) > min(
                    Decimal(str(policy.max_order_usd)),
                    Decimal(str(policy.max_daily_volume_usd)),
                    Decimal(str(policy.max_exposure_usd))) \
                or age < 0 or age > policy.max_analysis_age_seconds \
                or not proposal.evidence_ids:
            _block("managed_proposal_static_policy_denied")
        if int(row["expiresAt"]) <= int(datetime.now(timezone.utc).timestamp() * 1000) \
                or int(native["expiresAt"]) <= int(datetime.now(timezone.utc).timestamp() * 1000) \
                or context["profile"].get("paused") or context["strategy"].get("emergencyStop") \
                or context.get("availableCredits", 0) <= 0:
            _block("managed_proposal_or_activation_expired")
        controls = await request.app.state.runtime_controls.get()
        if controls.manual_guard:
            _block("manual_guard_blocks_automatic_execution")
        fingerprint = await _finance_context(convex, scope, controller)
        await _readiness()
        state = await current_account(finance, scope)
        if state["observation_snapshot_hash"] != native["financeSnapshotHash"] \
                or int(state["authority_epoch"]) != native_int(str(native["authorityEpoch"])):
            _block("activation_finance_snapshot_or_epoch_changed")
        if existing is None:
            raw_quote = await _sidecar("scoped-quote", {"scope": "buy",
                "amountIn": amount_in, "slippageBps": proposal.max_slippage_bps})
            quote = UniswapV3Quote.model_validate(raw_quote)
            if quote.amount_in != amount_in:
                raise FinanceError("sidecar quote amount differs from approved proposal")
            quote_hash = await UniswapQuoteEvidenceRepository(finance.engine).store_sidecar_quote(
                raw_quote, received_at=datetime.now(timezone.utc))
            policy, sizing = await initial_buy_request(finance, scope, state, quote, quote_hash)
            receipt = await finance.prepare_experiment_sizing_receipt(scope, epoch,
                int(state["revision"]), policy.policy_version, sizing)
            if receipt["quantity_units"] != quote.minimum_amount_out \
                    or receipt["notional_units"] != quote.amount_in:
                raise FinanceError("policy-sized buy differs from exact sidecar quote")
            expires = min(datetime.fromtimestamp(int(row["expiresAt"]) / 1000, timezone.utc),
                datetime.fromtimestamp(int(native["expiresAt"]) / 1000, timezone.utc),
                datetime.now(timezone.utc) + timedelta(seconds=policy.max_reservation_seconds))
            command = ReserveCommand.model_construct(scope=scope, controller_ref=controller,
                controller_mode="autopilot", expected_revision=int(state["revision"]),
                writer_epoch=epoch, authority_epoch=int(state["authority_epoch"]),
                authority_fingerprint=fingerprint, idempotency_key="native-uniswap-buy:" + body.proposal_id,
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
                raise FinanceError("durable reservation identity is unavailable")
        else:
            quote = await _stored_quote(finance, existing, scope)
            if quote.amount_in != amount_in or existing["status"] != "reserved":
                raise FinanceError("existing managed buy cannot be resubmitted")
        deadline = int(existing["expires_at"].timestamp())
        if deadline <= int(datetime.now(timezone.utc).timestamp()):
            _block("native_buy_reservation_expired")
        submit = _broadcast_input(native, scope, context, trade_intent,
                                  body.command_id, quote, deadline)
        prepared = await _sidecar("scoped-prepare-broadcast", submit)
        payload_hash = prepared.get("normalizedPayloadHash")
        if prepared.get("intentId") != trade_intent or prepared.get("clientId") != body.command_id \
                or prepared.get("amountIn") != quote.amount_in \
                or prepared.get("amountOutMinimum") != quote.minimum_amount_out \
                or prepared.get("owner") != native["ownerAddress"] \
                or not isinstance(payload_hash, str):
            raise FinanceError("prepared sidecar call differs from financial intent")
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
            expected_revision=int(state["revision"]))
        if marker.get("status") != "possible":
            raise FinanceError("possible submission marker was not committed")
        await convex.command("transitionTradeProposal", proposalId=body.proposal_id,
                            status="executing")
        try:
            await _sidecar("broadcast", submit, timeout=45)
        except Exception:
            state = await current_account(finance, scope)
            await finance.mark_submission_uncertain(scope, existing["reservation_id"],
                epoch, int(state["revision"]), "native-uniswap-uncertain:" + trade_intent)
        existing = await existing_trade(finance, scope, trade_intent)
        return await _reconcile_or_pending(finance, convex, settings, scope, native,
            context, row, existing, quote, trade_intent, body.command_id, epoch)
    except HTTPException:
        raise
    except (FinanceError, ValueError, KeyError, TypeError) as exc:
        _block(str(exc))
    except Exception:
        _block("managed_buy_dependency_unavailable", 503)
    finally:
        await convex.client.aclose()
