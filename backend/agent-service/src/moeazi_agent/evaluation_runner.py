import hashlib
import time
from datetime import datetime, timezone
from uuid import uuid4

from .convex import ConvexWorkerClient
from .evaluation_budget import reserve_evaluation_budget, settle_evaluation_budget
from .evaluation_engine import (
    actual_routing_cost, deterministic_intent, empty_scorecard,
    estimate_experiment, forecasts_from_synthesis, simulate_entry,
    update_scorecard, validate_grounding,
)
from .evaluation_outcomes import EvaluationOutcomeRepository
from .grounding_evaluator import evaluate_grounding
from .forecast_model import produce_forecasts
from .model_routing import routed_assignments
from .orchestrator import AnalysisOrchestrator, AnalysisRequest
from .prompt_bundles import prompt_bundle
from .provider_factory import build_provider_bundle
from .roles import assignments_for_tier
from .security import evidence_prompt_block
from .strategy_model import propose_trade_intent
from .evaluation_lifecycle import EvaluationLifecycleGate


async def run_evaluation_subject(
    repository, analysis_repository, redis, settings, spec, subject,
    experiment_id, case_id, market, market_snapshot, evidence,
) -> None:
    run_id = str(uuid4())
    lifecycle_gate = EvaluationLifecycleGate(
        # lifecycle-sink:evaluation-v1-provider
        analysis_repository.engine, run_id, market,
        datetime.fromisoformat(market_snapshot["observed_at"].replace("Z", "+00:00")),
        subject.account_id, subject.operator_subject)
    await lifecycle_gate("admission", f"evaluation:{experiment_id}:{case_id}:{subject.subject_id}",
        [ref.id for ref, _ in evidence])
    maximum = estimate_experiment(
        spec.model_copy(update={"subjects": [subject]}), 1,
    )["maximumPerObservationMicrousd"]
    await reserve_evaluation_budget(
        redis, experiment_id, maximum, spec.budget,
        int(settings.evaluation_global_budget_usd * 1_000_000),
    )
    configuration = None
    if subject.configuration_version and subject.operator_subject:
        configuration = await ConvexWorkerClient(settings).command(
            "getEvaluationModelConfiguration", subject=subject.operator_subject,
            version=subject.configuration_version,
        )
        if not configuration:
            raise RuntimeError(f"Configuration {subject.configuration_version} is unavailable")
    bundle = await build_provider_bundle(settings, analysis_repository.engine, configuration)
    routing = bundle.routing or subject.routing
    evidence_text = evidence_prompt_block(
        [(ref.id, content) for ref, content in evidence],
        settings.evidence_max_chars_per_item,
    )
    assignments = routed_assignments(assignments_for_tier(subject.tier), routing)
    prompts = []
    for item in assignments:
        rendered = prompt_bundle(item, market, evidence_text, subject.prompt_bundle_version)
        prompts.append({"role": item.role.name,
            "systemSha256": hashlib.sha256(str(rendered.get("system", "")).encode()).hexdigest(),
            "userSha256": hashlib.sha256(str(rendered.get("user", "")).encode()).hexdigest()})
    started = time.perf_counter()
    try:
        result = await AnalysisOrchestrator(
            bundle.providers, settings.provider_max_concurrency,
            allow_single_provider=settings.provider_mode == "deepseek_only",
            lifecycle_gate=lifecycle_gate,
            lifecycle_dispatch_gate=lifecycle_gate.verify_dispatch,
        ).run(AnalysisRequest(
            market=market, tier=subject.tier, scope="evaluation",
            evidence=evidence_text, evidence_refs=tuple(ref for ref, _ in evidence),
            model_routing=routing,
        ))
        validation = validate_grounding(
            result.reports, {ref.id for ref, _ in evidence}, market,
        )
        await _semantic_sample(
            validation, result, bundle, routing, spec, case_id, subject, market, evidence,
            lifecycle_gate,
        )
        forecasts = await _forecasts(
            result, bundle, routing, validation, market, evidence, lifecycle_gate,
        )
        strategies = await _strategies(
            result, bundle, routing, spec, market, market_snapshot, lifecycle_gate,
        )
        actual_cost = actual_routing_cost(routing, result.calls)
        await settle_evaluation_budget(redis, experiment_id, maximum, actual_cost)
        run = {
            "run_id": run_id, "experiment_id": experiment_id, "case_id": case_id,
            "subject_id": subject.subject_id, "analysis_id": result.synthesis.analysis_id,
            "status": "completed", "prompt_bundle": {
                "version": subject.prompt_bundle_version, "prompts": prompts,
                "systemBoundary": "Models analyze only and have no tools or execution access.",
            },
            "output": {
                "synthesis": result.synthesis.model_dump(mode="json"),
                "reports": [item.model_dump(mode="json") for item in result.reports],
                "calls": result.calls, "forecasts": forecasts,
            },
            "validation": validation, "strategy_results": strategies,
            "input_tokens": sum(int(item.get("input_tokens", 0)) for item in result.calls),
            "output_tokens": sum(int(item.get("output_tokens", 0)) for item in result.calls),
            "provider_cost_microusd": actual_cost,
            "latency_ms": int((time.perf_counter() - started) * 1_000), "error": None,
        }
    except Exception as exc:
        run = {
            "run_id": run_id, "experiment_id": experiment_id, "case_id": case_id,
            "subject_id": subject.subject_id, "analysis_id": None, "status": "failed",
            "prompt_bundle": {"version": subject.prompt_bundle_version, "prompts": prompts},
            "output": {}, "validation": {
                "flags": [{"code": "run_failure", "detail": str(exc)[:500]}],
            },
            "strategy_results": [], "input_tokens": 0, "output_tokens": 0,
            "provider_cost_microusd": 0,
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
    # lifecycle-sink:evaluation-v1-history
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


async def _semantic_sample(
    validation, result, bundle, routing, spec, case_id, subject, market, evidence,
    lifecycle_gate,
) -> None:
    sampled = (
        bool(validation["flags"])
        or int(hashlib.sha256(f"{case_id}:{subject.subject_id}".encode()).hexdigest()[:8], 16)
        / 0xFFFFFFFF < spec.semantic_sample_rate
    )
    if not sampled:
        return
    if not routing:
        validation["semanticGrounding"] = "not_configured"
        return
    try:
        route = routing.route("grounding_evaluator")
        verdict, call = await evaluate_grounding(
            bundle.providers[route.provider], route, market,
            [{"id": ref.id, "content": content} for ref, content in evidence],
            [item.model_dump(mode="json") for item in result.reports],
            lifecycle_gate,
        )
        result.calls.append(call)
        validation["semanticGrounding"] = "evaluated"
        validation["semanticVerdict"] = verdict.model_dump(mode="json")
        validation["flags"].extend({
            "code": "semantic_unsupported_claim", "detail": claim,
        } for claim in verdict.unsupported_claims)
    except Exception as exc:
        validation["semanticGrounding"] = "evaluator_failed"
        validation["flags"].append({
            "code": "semantic_evaluator_failure", "detail": str(exc)[:500],
        })


async def _forecasts(result, bundle, routing, validation, market, evidence,
        lifecycle_gate) -> list[dict]:
    if not routing:
        validation["forecastSource"] = "deterministic_fallback"
        return [
            item.model_dump(mode="json") for item in forecasts_from_synthesis(result.synthesis)
        ]
    try:
        route = routing.route("forecast")
        allowed = [ref.id for ref, _ in evidence]
        signal, call = await produce_forecasts(
            bundle.providers[route.provider], route, market,
            result.synthesis.model_dump(mode="json"),
            [item.model_dump(mode="json") for item in result.reports], allowed,
            lifecycle_gate,
        )
        result.calls.append(call)
        invented = sorted({
            identifier for claim in signal.claims for identifier in claim.evidence_ids
            if identifier not in set(allowed)
        })
        if invented:
            validation["flags"].append({
                "code": "forecast_invented_citation", "detail": ",".join(invented),
            })
        validation["forecastSource"] = "model"
        validation["forecastAction"] = signal.action
        return [item.model_dump(mode="json") for item in signal.forecasts]
    except Exception as exc:
        validation["forecastSource"] = "failed_fallback"
        validation["flags"].append({
            "code": "forecast_stage_failure", "detail": str(exc)[:500],
        })
        return [
            item.model_dump(mode="json") for item in forecasts_from_synthesis(result.synthesis)
        ]


async def _strategies(result, bundle, routing, spec, market, market_snapshot,
        lifecycle_gate) -> list[dict]:
    deterministic = deterministic_intent(result.synthesis, spec.strategy)
    results = []
    if "deterministic" in spec.strategy_modes:
        results.append(simulate_entry(
            deterministic, spec.strategy, market_snapshot, "deterministic",
        ))
    if "model_directed" in spec.strategy_modes:
        if routing:
            try:
                route = routing.route("strategy")
                intent, call = await propose_trade_intent(
                    bundle.providers[route.provider], route, market,
                    result.synthesis.model_dump(mode="json"),
                    [item.model_dump(mode="json") for item in result.reports],
                    spec.strategy, lifecycle_gate,
                )
                result.calls.append(call)
                results.append(simulate_entry(
                    intent, spec.strategy, market_snapshot, "model_directed",
                ))
            except Exception as exc:
                results.append({
                    "mode": "model_directed", "status": "rejected",
                    "reason": f"Strategy-stage model failed: {str(exc)[:300]}",
                })
        else:
            results.append({
                **simulate_entry(
                    deterministic, spec.strategy, market_snapshot, "model_directed",
                ),
                "reason": "Platform-default synthesis fallback; configure a versioned route for a dedicated strategy call.",
            })
    return results
