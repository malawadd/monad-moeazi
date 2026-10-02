from datetime import datetime, timedelta, timezone
from math import isfinite
import re
from typing import NewType

from temporalio import activity, workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    import httpx

    from moeazi_agent.config import get_settings
    from moeazi_agent.contracts import ProtectiveExits, TradeProposal
    from moeazi_agent.execution_controller import require_executable_controller
    from moeazi_agent.convex import ConvexWorkerClient
    from moeazi_agent.dependency_safety_boundaries import account_scope, gateway_observations
    from moeazi_agent.policy import AutomationPolicy, RiskContext
    from moeazi_agent.runtime_controls import RuntimeControlStore
    from moeazi_agent.storage import AnalysisRepository
    from moeazi_agent.tracing import TraceRepository


OwnedHyperliquidTradingAddress = NewType("OwnedHyperliquidTradingAddress", str)


async def gateway_call(path: str, payload: dict) -> dict:
    settings = get_settings()
    async with httpx.AsyncClient(
        base_url=settings.execution_gateway_url,
        timeout=30,
        headers={
            "Authorization": f"Bearer {settings.worker_shared_secret.get_secret_value()}",
            "Content-Type": "application/json",
        },
    ) as client:
        response = await client.post(path, json=payload)
        response.raise_for_status()
        return response.json()


async def managed_finance_buy_call(proposal_id: str, command_id: str) -> dict:
    settings = get_settings()
    async with httpx.AsyncClient(base_url=settings.agent_api_url, timeout=90,
            headers={"Authorization": f"Bearer {settings.worker_shared_secret.get_secret_value()}",
                     "Content-Type": "application/json"}) as client:
        response = await client.post("/v1/finance/managed-program/execute-buy",
            json={"proposalId": proposal_id, "commandId": command_id})
    if response.status_code == 409:
        data = response.json()
        detail = data.get("detail", {}) if isinstance(data, dict) else {}
        return {"status": "blocked", "reason": detail.get("reason", "managed_finance_denied")}
    response.raise_for_status()
    result = response.json()
    if not isinstance(result, dict) or result.get("status") not in {
            "executed", "executing", "uncertain", "blocked"}:
        raise RuntimeError("Managed finance API returned an invalid execution status")
    return result


async def managed_finance_buy_recovery_command(proposal_id: str) -> str:
    """Retrieve historical identity only; this never authorizes a new submission."""
    settings = get_settings()
    endpoint = settings.convex_worker_url.rstrip("/")
    if endpoint.endswith("/worker"):
        endpoint = endpoint[:-7]
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(endpoint + "/native-finance-trade/reconcile-context",
            json={"proposalId": proposal_id}, headers={
                "Authorization": f"Bearer {settings.worker_shared_secret.get_secret_value()}"})
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict) or data.get("authority") != "reconciliation_only" \
            or not isinstance(data.get("commandId"), str) or not data["commandId"]:
        raise RuntimeError("Historical managed trade identity is unavailable")
    return data["commandId"]


def protective_exits(proposal: TradeProposal, price: float) -> ProtectiveExits:
    if proposal.side == "long":
        return ProtectiveExits(stop_loss=price * 0.98, take_profit=price * 1.04)
    return ProtectiveExits(stop_loss=price * 1.02, take_profit=price * 0.96)


def proposal_agreement_strength(row: dict, proposal: TradeProposal) -> float:
    score = float(row["consensus"])
    if not isfinite(score) or not -1 <= score <= 1:
        raise ValueError("Proposal directional score is invalid")
    if row.get("controllerRef") is not None and score != 0 and (score > 0) != (proposal.side == "long"):
        raise ValueError("Proposal direction differs from signed score")
    strength = abs(score)
    if row.get("agreementStrength") is not None:
        declared = float(row["agreementStrength"])
        if not isfinite(declared) or abs(declared - strength) > 1e-12:
            raise ValueError("Proposal agreement strength differs from signed score")
    return strength


def resolve_owned_hyperliquid_trading_address(
    context: dict,
) -> OwnedHyperliquidTradingAddress | None:
    """Use only the exact Convex-verified active Hyperliquid account binding."""
    proof = context.get("hyperliquidTradingAddress")
    if not isinstance(proof, dict) or proof.get("schemaVersion") != 1 \
            or proof.get("source") != "verified_hyperliquid_binding":
        return None
    strategy_id = str(context.get("strategy", {}).get("_id", ""))
    proposal_strategy_id = str(context.get("proposal", {}).get("strategyAccountId", ""))
    master = proof.get("masterAddress")
    target = proof.get("targetAddress")
    kind = proof.get("targetKind")
    expires_at = proof.get("permissionExpiresAt")
    if not strategy_id or strategy_id != proposal_strategy_id \
            or proof.get("strategyAccountId") != strategy_id \
            or not isinstance(proof.get("venueAccountId"), str) \
            or not proof["venueAccountId"] \
            or not isinstance(master, str) or not isinstance(target, str) \
            or not re.fullmatch(r"0x[0-9a-f]{40}", master) \
            or not re.fullmatch(r"0x[0-9a-f]{40}", target) \
            or kind not in {"master", "subaccount"} \
            or (kind == "master") != (target == master) \
            or not isinstance(expires_at, (int, float)) \
            or isinstance(expires_at, bool) \
            or expires_at <= int(datetime.now(timezone.utc).timestamp() * 1000):
        return None
    return OwnedHyperliquidTradingAddress(target)


@activity.defn
async def execute_proposal_activity(payload: dict) -> dict:
    settings = get_settings()
    convex = ConvexWorkerClient(settings)
    context = await convex.command(
        "getTradeProposalExecutionContext", proposalId=payload["proposal_id"],
    )
    if not context:
        command_id = await managed_finance_buy_recovery_command(payload["proposal_id"])
        return await managed_finance_buy_call(payload["proposal_id"], command_id)
    row = context["proposal"]
    proposal = TradeProposal.model_validate(row["payload"])
    if not row.get("controllerRef") or not row.get("controllerMode") or not context.get("controllerRef"):
        raise RuntimeError("Proposal controller or mode provenance is unavailable")
    require_executable_controller(row, context)
    managed_uniswap = bool(context.get("nativeAuthority") and
        proposal.candidate_venues == ["uniswap"] and
        row["controllerRef"].get("controllerKind") == "managed_program")
    if row["status"] != "approved" and not (managed_uniswap and row["status"] == "executing"):
        raise RuntimeError(f"Proposal is not executable: {row['status']}")
    if managed_uniswap and row["status"] == "executing":
        return await managed_finance_buy_call(row["_id"], row["idempotencyKey"])
    if row["expiresAt"] <= int(datetime.now(timezone.utc).timestamp() * 1000):
        await convex.command("transitionTradeProposal", proposalId=row["_id"], status="expired")
        return {"status": "expired"}
    if context["profile"].get("paused") or context["strategy"].get("emergencyStop"):
        await convex.command("transitionTradeProposal", proposalId=row["_id"], status="blocked")
        return {"status": "blocked", "reason": "Agent or strategy is paused"}
    if context["availableCredits"] <= 0:
        await convex.command("transitionTradeProposal", proposalId=row["_id"], status="blocked")
        return {"status": "blocked", "reason": "Credits are exhausted"}
    if payload.get("automatic"):
        from redis.asyncio import Redis
        redis = Redis.from_url(settings.redis_url)
        try:
            controls = await RuntimeControlStore(redis, settings).get()
            if controls.manual_guard:
                await convex.command("transitionTradeProposal", proposalId=row["_id"], status="blocked")
                return {"status": "blocked", "reason": "Manual Guard blocks automatic execution"}
        finally:
            await redis.aclose()
    venue = proposal.candidate_venues[0]
    if managed_uniswap:
        return await managed_finance_buy_call(row["_id"], row["idempotencyKey"])
    policy = AutomationPolicy.from_convex({
        **context["policy"]["policy"], "version": context["policy"]["version"],
    })
    now = datetime.now(timezone.utc)
    risk = RiskContext(
        now=now, analysis_created_at=datetime.fromtimestamp(row["createdAt"] / 1000, timezone.utc),
        confidence=row["confidence"], consensus=proposal_agreement_strength(row, proposal),
        daily_volume_usd=0,
        current_exposure_usd=0, daily_loss_usd=0, drawdown_pct=0,
        concurrent_positions=0, credits_spent_today=0,
        emergency_stop=context["strategy"].get("emergencyStop", False),
        provider_quorum=True, evidence_complete=bool(proposal.evidence_ids),
        venue_healthy=False, reconciliation_clear=False,
    )
    idempotency_key = row["idempotencyKey"]
    safety_subject_key = f"proposal:{row['_id']}"
    safety_scope = account_scope(proposal.account_id, proposal.market, venue)
    safety_observations = gateway_observations(context)
    safety_payload = {
        "venue": venue, "proposal": proposal.model_dump(mode="json"),
        "policy": policy.model_dump(mode="json"), "context": risk.model_dump(mode="json"),
        "quote_request": {"market": proposal.market, "side": proposal.side, "size_usd": proposal.size_usd},
        "idempotency_key": idempotency_key, "safety_scope": safety_scope.model_dump(mode="json"),
        "safety_subject_key": safety_subject_key,
        "safety_observations": {key: value.model_dump(mode="json") for key, value in safety_observations.items()},
        "safety_evaluated_at": now.isoformat(),
        "safety_bindings": {"market": proposal.market.upper(), "venue": venue.lower()},
    }
    admission = await gateway_call("/internal/preflight/admission", safety_payload)
    await convex.command("transitionTradeProposal", proposalId=row["_id"], status="executing")
    safety_observed_at = datetime.now(timezone.utc)
    checked = await gateway_call("/internal/preflight", {
        **safety_payload, "safety_evaluated_at": safety_observed_at.isoformat(),
        "admission_decision": admission["preflightAdmissionDecision"],
    })
    quote = checked["quote"]
    price = float(quote["raw"]["price"])
    await record_execution_trace(
        settings, proposal, "quote", "completed",
        {"venue": venue, "market": proposal.market, "sizeUsd": proposal.size_usd},
        {"reference": quote.get("reference"), "price": price},
        f"Fetched a fresh executable {venue} quote at {price:,.4f}.",
    )
    decision = checked["decision"]
    for key, label in (("preflightSafetyDecision", "preflight"), ("safetyDecision", "submit")):
        safety = checked[key]
        await record_execution_trace(
            settings, proposal, f"dependency_safety_{label}",
            "completed" if safety["outcome"] == "allow" else "blocked",
            {"operation": safety["operation"], "receiptHashes": [item[:12] for item in safety["receipt_hashes"]]},
            {"mode": safety["mode"], "outcome": safety["outcome"], "reasons": safety["reasons"],
             "decisionHash": safety["decision_hash"][:12]},
            f"Dependency safety {safety['outcome']}ed {safety['operation']} in {safety['mode']} mode.",
        )
    await record_execution_trace(
        settings, proposal, "policy_check", "completed" if decision["result"] == "pass" else "blocked",
        {"policyVersion": policy.version, "quoteReference": quote.get("reference")},
        {"result": decision["result"], "checks": decision["checks"]},
        f"Deterministic execution policy {decision['result']}ed the fresh quote.",
    )
    if decision["result"] != "pass":
        await convex.command("transitionTradeProposal", proposalId=row["_id"], status="blocked")
        return {"status": "blocked", "checks": decision["checks"]}

    # ExecutionGateway.execute_or_simulate chooses its native lane from these same
    # deployment settings. If that lane could submit, require an owned address before
    # crossing the gateway boundary. The Compose worker and gateway share this env.
    native_dispatch_enabled = (
        bool(getattr(settings, "live_execution_enabled", False))
        and venue in getattr(settings, "certified_venue_set", frozenset())
    )
    hyperliquid_address = (
        resolve_owned_hyperliquid_trading_address(context)
        if venue == "hyperliquid" else None
    )
    if venue == "hyperliquid" and native_dispatch_enabled:
        block_reason = ("Verified owned Hyperliquid trading address is unavailable"
            if hyperliquid_address is None else
            "Native financial order package is unavailable")
        execution = {
            "status": "not_submitted", "venue": venue,
            "idempotencyKey": idempotency_key,
            "reason": block_reason,
        }
        reconciliation = {
            "status": "unavailable",
            "reason": block_reason,
        }
        await record_execution_trace(
            settings, proposal, "execution", "blocked",
            {"venue": venue, "idempotencyKey": idempotency_key}, execution,
            "Native dispatch was not attempted without complete Hyperliquid account and financial order authority.",
        )
        await convex.command(
            "transitionTradeProposal", proposalId=row["_id"], status="blocked",
        )
        return {
            "status": "blocked", "execution": execution,
            "reconciliation": reconciliation, "checks": decision["checks"],
        }

    execution = await gateway_call("/internal/dispatch", {
        "venue": venue,
        "request": proposal.model_dump(mode="json"),
        "decision": decision,
        "idempotency_key": idempotency_key,
        "safety_subject_key": safety_subject_key,
        "safety_decision": checked["safetyDecision"],
    })
    reconciliation = None
    if execution.get("status") in {"submitted", "executed", "uncertain", "pending"}:
        if venue == "hyperliquid" and hyperliquid_address is None:
            reconciliation = {
                "status": "unavailable",
                "reason": "Verified owned Hyperliquid trading address is unavailable",
            }
        else:
            reconcile_idempotency = f"{idempotency_key}:reconcile"
            reconcile_subject = f"reconcile:{row['_id']}"
            reconcile_account = (
                str(hyperliquid_address)
                if venue == "hyperliquid" else proposal.account_id
            )
            reconcile_checked = await gateway_call("/internal/reconcile/preflight", {
                "venue": venue, "account": reconcile_account,
                "idempotency_key": reconcile_idempotency,
                "safety_subject_key": reconcile_subject,
                "safety_scope": safety_scope.model_dump(mode="json"),
                "safety_observations": {
                    key: value.model_dump(mode="json") for key, value in safety_observations.items()
                },
                "safety_evaluated_at": datetime.now(timezone.utc).isoformat(),
            })
            reconciliation = await gateway_call("/internal/reconcile", {
                "venue": venue, "account": reconcile_account,
                "idempotency_key": reconcile_idempotency,
                "safety_subject_key": reconcile_subject,
                "safety_decision": reconcile_checked["safetyDecision"],
            })
    await record_execution_trace(
        settings, proposal, "execution", execution.get("status", "completed"),
        {"venue": venue, "idempotencyKey": idempotency_key}, execution,
        f"Execution gateway returned {execution.get('status', 'completed')} for {venue}.",
    )
    if execution.get("status") == "simulated":
        await convex.command("transitionTradeProposal", proposalId=row["_id"], status="simulated")
    # Native dispatch and read-only reconciliation are not fill confirmation. Keep
    # those proposals executing until a future authoritative reconciliation path.
    return {
        "status": execution["status"], "execution": execution,
        "reconciliation": reconciliation, "checks": decision["checks"],
    }


async def record_execution_trace(
    settings, proposal: TradeProposal, event_type: str, status: str,
    input_summary: dict, output_summary: dict, decision_summary: str,
) -> None:
    from redis.asyncio import Redis
    redis = Redis.from_url(settings.redis_url)
    try:
        repository = AnalysisRepository(settings.postgres_dsn)
        await TraceRepository(repository.engine, redis).append({
            "event_id": f"{proposal.analysis_id}:{event_type}",
            "analysis_id": proposal.analysis_id, "account_id": proposal.account_id,
            "event_type": event_type, "status": status,
            "input_summary": input_summary, "output_summary": output_summary,
            "decision_summary": decision_summary,
        })
    except Exception:
        return
    finally:
        await redis.aclose()


@workflow.defn
class ExecutionWorkflow:
    @workflow.run
    async def run(self, payload: dict) -> dict:
        return await workflow.execute_activity(
            execute_proposal_activity,
            payload,
            start_to_close_timeout=timedelta(minutes=3),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
