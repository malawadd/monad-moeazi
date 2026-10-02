import hashlib

from .evaluation_engine import deterministic_intent, simulate_entry
from .forecast_model import produce_forecasts
from .grounding_evaluator import evaluate_grounding
from .model_routing import ModelRoute
from .strategy_model import propose_trade_intent


async def semantic_stage(
    validation, calls, bundle, routing, settings, spec, case_id,
    subject_id, market, evidence, reports, lifecycle_gate,
):
    if not spec.stages.semantic_grounding:
        validation["semanticGrounding"] = "not_evaluated"
        return
    sampled = bool(validation["flags"]) or (
        int(hashlib.sha256(f"{case_id}:{subject_id}".encode()).hexdigest()[:8], 16)
        / 0xFFFFFFFF < spec.stages.semantic_sample_rate
    )
    if not sampled:
        validation["semanticGrounding"] = "not_sampled"
        return
    route = evaluation_route(
        routing, "grounding_evaluator", settings, "semantic_grounding",
    )
    verdict, call = await evaluate_grounding(
        bundle.providers[route.provider], route, market,
        [{"id": ref.id, "content": content} for ref, content in evidence],
        [item.model_dump(mode="json") for item in reports],
        lifecycle_gate,
    )
    calls.append(call)
    validation["semanticGrounding"] = "evaluated"
    validation["semanticVerdict"] = verdict.model_dump(mode="json")


async def forecast_stage(
    calls, bundle, routing, settings, spec, market, evidence, reports, synthesis,
    lifecycle_gate,
):
    if not spec.stages.forecast:
        return []
    route = evaluation_route(routing, "forecast", settings, "forecast")
    signal, call = await produce_forecasts(
        bundle.providers[route.provider], route, market,
        synthesis.model_dump(mode="json"),
        [item.model_dump(mode="json") for item in reports],
        [ref.id for ref, _ in evidence], lifecycle_gate,
    )
    calls.append(call)
    selected = set(spec.horizons)
    return [
        item.model_dump(mode="json") for item in signal.forecasts
        if item.horizon in selected
    ]


async def strategy_stages(
    calls, bundle, routing, settings, spec, market, snapshot, reports, synthesis,
    lifecycle_gate,
):
    results = []
    if spec.stages.deterministic_strategy:
        results.append(simulate_entry(
            deterministic_intent(synthesis, spec.strategy),
            spec.strategy, snapshot, "deterministic",
        ))
    if spec.stages.model_strategy:
        route = evaluation_route(routing, "strategy", settings, "model_strategy")
        intent, call = await propose_trade_intent(
            bundle.providers[route.provider], route, market,
            synthesis.model_dump(mode="json"),
            [item.model_dump(mode="json") for item in reports], spec.strategy,
            lifecycle_gate,
        )
        calls.append(call)
        results.append(simulate_entry(
            intent, spec.strategy, snapshot, "model_directed",
        ))
    return results


def evaluation_route(routing, slot, settings, stage) -> ModelRoute:
    if routing:
        return routing.route(slot)
    specialist = stage == "specialist"
    output_cap = 700 if specialist else 1_200 if stage == "synthesis" else 500
    return ModelRoute(
        slot=slot, provider="deepseek",
        model=(
            settings.deepseek_specialist_model if specialist
            else settings.deepseek_synthesis_model
        ),
        credentialSource="platform", maxOutputTokens=output_cap,
        inputPriceMicrousdPerMillion=140_000 if specialist else 435_000,
        cachedInputPriceMicrousdPerMillion=2_800 if specialist else 3_625,
        outputPriceMicrousdPerMillion=280_000 if specialist else 870_000,
    )
