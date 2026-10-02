import json
import time

from .evaluation_contracts import EvaluationSignal
from .grounding_evaluator import structured_evaluation
from .model_routing import ModelRoute


SYSTEM = """You are a simulation-only forecast stage with no tools or execution
access. Produce calibrated 5m, 1h, 4h, and 24h probabilities from the supplied
validated specialist reports and team synthesis. Every material claim must cite a
supplied evidence ID. Abstain when evidence is inadequate. Return no hidden
chain-of-thought and only the requested typed output."""


async def produce_forecasts(
    provider, route: ModelRoute, market: str, synthesis: dict,
    reports: list[dict], evidence_ids: list[str], lifecycle_gate,
) -> tuple[EvaluationSignal, dict]:
    prompt = json.dumps({
        "market": market, "synthesis": synthesis, "specialists": reports,
        "allowedEvidenceIds": evidence_ids,
        "requiredHorizons": ["5m", "1h", "4h", "24h"],
    }, separators=(",", ":"), default=str)
    started = time.perf_counter()
    value, usage = await structured_evaluation(
        provider, route, prompt, EvaluationSignal, "multi_horizon_forecast", SYSTEM,
        lifecycle_gate, evidence_ids,
    )
    signal = EvaluationSignal.model_validate(value)
    call = {
        "role": "forecast", "kind": "synthesis", "provider": provider.name,
        "model": route.model, "status": "completed",
        "prompt_hash": __import__("hashlib").sha256(prompt.encode()).hexdigest(),
        "decision_summary": signal.decision_summary,
        "input_tokens": usage.input_tokens, "cached_input_tokens": usage.cached_input_tokens,
        "output_tokens": usage.output_tokens,
        "provider_cost_microusd": usage.provider_cost_microusd or 0,
        "cost_source": usage.cost_source,
        "credential_source": route.credential_source,
        "served_model": (usage.routing_metadata or {}).get("servedModel"),
        "upstream_provider": (usage.routing_metadata or {}).get("upstreamProvider"),
        "latency_ms": int((time.perf_counter() - started) * 1_000),
    }
    return signal, call
