import hashlib
import json
import os
import time
from dataclasses import replace
from datetime import datetime, timezone
from uuid import uuid4

from .contracts import AgentRunView, SignalReport, SynthesisDraft
from .citation_grounding import (
    canonicalize_evaluation_citations, mark_citation_validation_unqualified,
)
from .evaluation_engine import empty_scorecard, update_scorecard, validate_grounding
from .evaluation_outcomes import EvaluationOutcomeRepository
from .evaluation_storage import EvaluationRepository
from .evaluation_v2_storage import EvaluationV2Repository
from .grounding_evaluator import structured_evaluation
from .model_routing import provider_preferences
from .evaluation_pipeline_stages import (
    evaluation_route, forecast_stage, semantic_stage, strategy_stages,
)
from .provider_factory import ProviderBundle, build_provider_bundle
from .providers import DeterministicProvider, specialist_prompt, synthesis_prompt
from .roles import Assignment, ROLES
from .security import SYSTEM_BOUNDARY, evidence_prompt_block
from .strategy_model import propose_trade_intent
from .synthesis import synthesize
from .evaluation_lifecycle import EvaluationLifecycleGate


async def run_v2_observation(
    analysis_repository, redis, settings, spec, experiment_id: str,
    case_id: str, market: str, market_snapshot: dict, evidence,
    run_observed_at: datetime,
) -> None:
    repository = EvaluationRepository(analysis_repository.engine)
    for subject in spec.subjects:
        await _run_subject(
            repository, analysis_repository, settings, spec, subject,
            experiment_id, case_id, market, market_snapshot, evidence, run_observed_at,
        )


async def _run_subject(
    repository, analysis_repository, settings, spec, subject,
    experiment_id, case_id, market, market_snapshot, evidence, run_observed_at,
) -> None:
    configuration = None
    if subject.configuration_version and subject.operator_subject:
        from .convex import ConvexWorkerClient
        configuration = await ConvexWorkerClient(settings).command(
            "getEvaluationModelConfiguration", subject=subject.operator_subject,
            version=subject.configuration_version,
        )
    customer = await EvaluationV2Repository(analysis_repository.engine).customer_identity(experiment_id)
    local_flag = (settings.environment in {"local", "development", "test"}
                  and os.getenv("AGENT_CUSTOMER_RESEARCH_DETERMINISTIC") == "true")
    frozen_flag = bool(customer and customer["work_plan"].get("localDeterministic"))
    if customer and local_flag != frozen_flag:
        raise RuntimeError("Local deterministic research setting changed; no provider call was made")
    if frozen_flag:
        deterministic = DeterministicProvider()
        bundle = ProviderBundle({route.provider: deterministic for route in subject.routing.routes},
                                subject.routing)
    else:
        bundle = await build_provider_bundle(settings, analysis_repository.engine, configuration)
    routing = subject.routing or bundle.routing
    prompt_asset = await _prompt_asset(
        analysis_repository.engine, subject.prompt_bundle_id, subject.operator_subject,
    )
    evidence_text = evidence_prompt_block(
        [(ref.id, content) for ref, content in evidence],
        settings.evidence_max_chars_per_item,
    )
    started = time.perf_counter()
    run_id = str(uuid4())
    lifecycle_gate = EvaluationLifecycleGate(
        # lifecycle-sink:evaluation-v2-provider
        analysis_repository.engine, run_id, market,
        run_observed_at, subject.account_id, subject.operator_subject,
        provider_observed_at=run_observed_at)
    calls = []
    rendered_prompts = []
    try:
        reports = []
        role_settings = {item.id: item for item in subject.role_settings}
        for index, role_name in enumerate(subject.selected_roles):
            role = next((item for item in ROLES if item.name == role_name), None)
            if not role:
                raise RuntimeError(f"Unknown evaluation role: {role_name}")
            setting = role_settings.get(role_name)
            if setting:
                role = replace(role, horizon=setting.horizon)
            route = evaluation_route(routing, f"role:{role_name}", settings, "specialist")
            assignment = Assignment(
                role, route.provider, route.model, route.credential_source,
                route.max_output_tokens, route.reasoning_effort,
                provider_preferences(route),
                instructions=setting.instructions if setting else "",
            )
            system, user = _render_prompt(
                prompt_asset, role_name, SYSTEM_BOUNDARY,
                specialist_prompt(assignment, market, evidence_text), market, evidence_text,
            )
            report, call = await _typed_call(
                bundle.providers[route.provider], route, user, SignalReport,
                f"evaluation_{role_name}", system, role_name, lifecycle_gate,
                [ref.id for ref, _ in evidence],
            )
            report = canonicalize_evaluation_citations(
                report, (ref for ref, _ in evidence), call,
            )
            report = report.model_copy(update={
                "role": role_name, "provider": "deterministic" if frozen_flag else route.provider,
                "model": "deterministic-v1" if frozen_flag else route.model,
                "horizon": role.horizon,
            })
            call["decision_summary"] = report.decision_summary
            calls.append(call)
            reports.append(report)
            rendered_prompts.append(_prompt_trace(role_name, system, user, route, report))
        if len(reports) < subject.quorum_minimum:
            raise RuntimeError("Selected team did not meet its frozen quorum")
        route = evaluation_route(routing, "synthesis", settings, "synthesis")
        materials = [item.model_dump(mode="json") for item in reports]
        default_synthesis = synthesis_prompt(market, subject.tier, "synthesis", materials)
        system, user = _render_prompt(
            prompt_asset, "synthesis", SYSTEM_BOUNDARY,
            default_synthesis, market, evidence_text,
        )
        draft, synthesis_call = await _typed_call(
            bundle.providers[route.provider], route, user, SynthesisDraft,
            "evaluation_synthesis", system, "synthesis", lifecycle_gate,
            [ref.id for ref, _ in evidence],
        )
        calls.append(synthesis_call)
        rendered_prompts.append(_prompt_trace("synthesis", system, user, route, draft))
        views = [_run_view(call) for call in calls]
        result = synthesize(
            market, subject.tier, reports, views, 0, draft=draft,
        )
        validation = validate_grounding(
            reports, {ref.id for ref, _ in evidence}, market,
        )
        mark_citation_validation_unqualified(validation, calls)
        await semantic_stage(
            validation, calls, bundle, routing, settings, spec, case_id,
            subject.subject_id, market, evidence, reports, lifecycle_gate,
        )
        forecasts = await forecast_stage(
            calls, bundle, routing, settings, spec,
            market, evidence, reports, result, lifecycle_gate,
        )
        strategies = await strategy_stages(
            calls, bundle, routing, settings, spec, market,
            market_snapshot, reports, result, lifecycle_gate,
        )
        actual_cost = sum(int(item.get("provider_cost_microusd", 0)) for item in calls)
        run = {
            "run_id": run_id, "experiment_id": experiment_id, "case_id": case_id,
            "subject_id": subject.subject_id, "analysis_id": result.analysis_id,
            "status": "completed", "prompt_bundle": {
                "version": subject.prompt_bundle_id, "prompts": rendered_prompts,
                "systemBoundary": SYSTEM_BOUNDARY,
            },
            "output": {
                "synthesis": result.model_dump(mode="json"),
                "reports": [item.model_dump(mode="json") for item in reports],
                "calls": calls, "forecasts": forecasts,
            },
            "validation": validation, "strategy_results": strategies,
            "input_tokens": sum(int(item.get("input_tokens", 0)) for item in calls),
            "output_tokens": sum(int(item.get("output_tokens", 0)) for item in calls),
            "provider_cost_microusd": actual_cost,
            "latency_ms": int((time.perf_counter() - started) * 1_000), "error": None,
        }
    except Exception as exc:
        run = {
            "run_id": run_id, "experiment_id": experiment_id, "case_id": case_id,
            "subject_id": subject.subject_id, "analysis_id": None, "status": "failed",
            "prompt_bundle": {"version": subject.prompt_bundle_id, "prompts": rendered_prompts},
            "output": {"calls": calls}, "validation": {
                "flags": [{"code": "run_failure", "detail": str(exc)[:500]}],
            },
            "strategy_results": [], "input_tokens": 0, "output_tokens": 0,
            "provider_cost_microusd": sum(
                int(item.get("provider_cost_microusd", 0)) for item in calls
            ),
            "latency_ms": int((time.perf_counter() - started) * 1_000),
            "error": str(exc)[:2_000],
        }
    finally:
        await bundle.close()
    previous = await repository.latest_subject_run(experiment_id, subject.subject_id)
    if previous:
        run["previousConsensus"] = (
            previous.get("output", {}).get("synthesis") or {}
        ).get("consensus")
    # lifecycle-sink:evaluation-v2-history
    _lifecycle_hash, admitted_run = await lifecycle_gate.archive(case_id, run)
    await repository.save_run(admitted_run)
    if admitted_run["status"] == "completed":
        await EvaluationOutcomeRepository(analysis_repository.engine).record_run_artifacts(
            admitted_run, market, float(market_snapshot.get("mark_price") or 0),
            datetime.fromisoformat(market_snapshot["observed_at"]),
        )
    card = await repository.get_scorecard(experiment_id, subject.subject_id)
    await repository.replace_scorecard(update_scorecard(
        card or empty_scorecard(experiment_id, subject.subject_id), admitted_run,
    ))


async def _typed_call(provider, route, prompt, output, name, system, role,
        lifecycle_gate, evidence_ids):
    started = time.perf_counter()
    value, usage = await structured_evaluation(
        provider, route, prompt, output, name, system, lifecycle_gate, evidence_ids,
    )
    metadata = usage.routing_metadata or {}
    call = {
        "role": role,
        "kind": "synthesis" if role in {
            "synthesis", "forecast", "strategy", "grounding_evaluator",
        } else "specialist",
        "provider": provider.name,
        "model": "deterministic-v1" if provider.name == "deterministic" else route.model,
        "status": "completed",
        "prompt_hash": hashlib.sha256(f"{system}\n{prompt}".encode()).hexdigest(),
        "raw_sanitized_output": value.model_dump_json(),
        "input_tokens": usage.input_tokens,
        "cached_input_tokens": usage.cached_input_tokens,
        "output_tokens": usage.output_tokens,
        "provider_cost_microusd": (
            usage.provider_cost_microusd
            if usage.provider_cost_microusd is not None
            else _usage_cost(route, usage)
        ),
        "cost_source": usage.cost_source, "credential_source": route.credential_source,
        "served_model": metadata.get("servedModel") or route.model,
        "upstream_provider": metadata.get("upstreamProvider"),
        "latency_ms": int((time.perf_counter() - started) * 1_000),
    }
    return value, call


async def _prompt_asset(engine, bundle_id, owner):
    if bundle_id == "agent-v2":
        return None
    row = await EvaluationV2Repository(engine).asset(bundle_id, owner)
    if not row or row["asset_type"] != "prompt_bundle" or row["status"] != "frozen":
        raise RuntimeError("Frozen prompt bundle is unavailable")
    return row["payload"]


def _render_prompt(asset, key, default_system, default_user, market, evidence):
    if not asset or key not in asset.get("prompts", {}):
        return default_system, default_user
    value = asset["prompts"][key]
    system = str(value.get("system", default_system))
    user = str(value.get("user", default_user))
    return system, user.replace("{{market}}", market).replace("{{evidence}}", evidence)


def _prompt_trace(role, system, user, route, output):
    serialized = f"{system}\n{user}"
    return {
        "role": role,
        "systemSha256": hashlib.sha256(system.encode()).hexdigest(),
        "userSha256": hashlib.sha256(user.encode()).hexdigest(),
        "sha256": hashlib.sha256(serialized.encode()).hexdigest(),
        "schema": output.__class__.model_json_schema(),
        "requestedModel": route.model, "provider": route.provider,
        "maxOutputTokens": route.max_output_tokens,
        "pricing": {
            "input": route.input_price, "cachedInput": route.cached_input_price,
            "output": route.output_price,
        },
    }


def _run_view(call) -> AgentRunView:
    return AgentRunView(
        role=call["role"], provider=call["provider"], model=call["model"],
        status="completed", latency_ms=call["latency_ms"],
        input_tokens=call["input_tokens"], output_tokens=call["output_tokens"],
        cached_input_tokens=call["cached_input_tokens"],
        provider_cost_microusd=call["provider_cost_microusd"],
        credential_source=call["credential_source"],
        served_model=call.get("served_model"),
        upstream_provider=call.get("upstream_provider"),
    )


def _usage_cost(route, usage) -> int:
    cached = min(usage.input_tokens, usage.cached_input_tokens)
    return round((
        (usage.input_tokens - cached) * route.input_price
        + cached * route.cached_input_price + usage.output_tokens * route.output_price
    ) / 1_000_000)
