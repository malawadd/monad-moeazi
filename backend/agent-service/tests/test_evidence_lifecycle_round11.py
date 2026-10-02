import copy
import json
from datetime import timedelta

import pytest
from pydantic import BaseModel

from moeazi_agent import grounding_evaluator, test_center
from moeazi_agent.evidence_lifecycle_dispatch import _contract_hash
from moeazi_agent.model_routing import ModelRoute
from moeazi_agent.orchestrator import AnalysisOrchestrator, AnalysisRequest
from moeazi_agent.test_center import ControlUpdate, cas_controls, freeze_control_snapshot
from test_evidence_lifecycle_round10 import (
    RUN, CountingProvider, PersistedGate, make_decision, persisted_row, repository_for,
)

DEFECTS = ("missing", "malformed", "payload", "hash", "column", "expectedCopies",
    "policy", "scope", "artifact", "past-expiry", "exact-boundary")


def shortened_authority(decision, schedule):
    expiry = RUN + timedelta(minutes=1)
    seed = schedule.model_copy(update={"body_expires_at": expiry,
        "schedule_id": "ers_" + "0" * 48, "schedule_hash": "0" * 64})
    schedule_hash = _contract_hash(seed, {"schedule_id", "schedule_hash"},
        ("body_expires_at",))
    schedule = seed.model_copy(update={"schedule_id": f"ers_{schedule_hash[:48]}",
        "schedule_hash": schedule_hash})
    seed = decision.model_copy(update={"retention_schedule_hash": schedule_hash,
        "decision_id": "eld_" + "0" * 48, "decision_hash": "0" * 64})
    decision_hash = _contract_hash(seed, {"decision_id", "decision_hash"},
        ("evaluated_at", "expires_at"))
    decision = seed.model_copy(update={"decision_id": f"eld_{decision_hash[:48]}",
        "decision_hash": decision_hash})
    return decision, schedule


def corrupt(row, defect):
    if defect == "malformed": row.schedule_payload = "{"
    elif defect == "payload":
        row.schedule_payload = {**row.schedule_payload,
            "minimal_safety_paths": ["forged_path"]}
    elif defect == "hash": row.schedule_hash = "f" * 64
    elif defect == "column": row.schedule_id = "ers_" + "f" * 48
    elif defect == "expectedCopies": row.schedule_expected_copies = ["forged.copy"]
    elif defect == "policy": row.schedule_policy_hash = "f" * 64
    elif defect == "scope": row.schedule_scope_key = "tenant:forged"
    elif defect == "artifact": row.schedule_artifact_id = "forged-artifact"


class DefectiveGate(PersistedGate):
    def __init__(self, defect):
        super().__init__(RUN)
        self.defect = defect

    async def __call__(self, stage, content, evidence_ids):
        admitted = await super().__call__(stage, content, evidence_ids)
        decision, schedule = self.decisions[stage]
        if self.defect in {"past-expiry", "exact-boundary"}:
            self.rows.pop(decision.decision_hash)
            decision, schedule = shortened_authority(decision, schedule)
            self.decisions[stage] = (decision, schedule)
            self.rows[decision.decision_hash] = persisted_row(decision, schedule)
            self.now = schedule.body_expires_at + (timedelta(microseconds=1)
                if self.defect == "past-expiry" else timedelta())
        elif self.defect == "missing": self.rows.clear()
        else: corrupt(self.rows[decision.decision_hash], self.defect)
        return admitted


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["specialist", "synthesis"])
@pytest.mark.parametrize("defect", DEFECTS)
async def test_orchestrator_rejects_every_schedule_defect_without_side_effect(stage, defect):
    provider = CountingProvider()
    gate = DefectiveGate(defect)
    orchestrator = AnalysisOrchestrator({"openai": provider, "deepseek": provider},
        max_concurrency=1, allow_single_provider=True, lifecycle_gate=gate,
        lifecycle_dispatch_gate=gate.verify_dispatch)
    with pytest.raises(RuntimeError, match="authority"):
        if stage == "specialist":
            await orchestrator.run(AnalysisRequest(
                market="ETH", tier="max", scope="evaluation", lite_mode=True))
        else:
            await orchestrator._synthesis_call("synthesis", "openai",
                AnalysisRequest(market="ETH", tier="focus", scope="evaluation"), [])
    assert (provider.analysis_calls, provider.synthesis_calls,
        provider.credits, provider.cost_microusd) == (0, 0, 0, 0)


class Output(BaseModel):
    value: str


class Counter:
    def __init__(self): self.calls = self.credits = self.cost_microusd = 0
    async def invoke(self, *_args, **_kwargs):
        self.calls += 1; self.credits += 1; self.cost_microusd += 1
        raise AssertionError("provider dispatch must not occur")


def provider_for(monkeypatch, kind, counter):
    if kind == "openai":
        class Responses: parse = counter.invoke
        class Client: responses = Responses()
        class Provider: name = "openai"; client = Client()
        monkeypatch.setattr(grounding_evaluator, "OpenAIProvider", Provider)
    elif kind == "deepseek":
        class Client: post = counter.invoke
        class Provider: name = "deepseek"; client = Client()
        monkeypatch.setattr(grounding_evaluator, "DeepSeekProvider", Provider)
    else:
        class Provider:
            name = "openrouter"
            def _body(self, *_args): return {"messages": [{"content": ""}]}
            _request = counter.invoke
        monkeypatch.setattr(grounding_evaluator, "OpenRouterProvider", Provider)
    return Provider()


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["openai", "deepseek", "openrouter"])
@pytest.mark.parametrize("defect", DEFECTS)
async def test_every_v2_provider_rejects_every_schedule_defect(monkeypatch, kind, defect):
    counter = Counter()
    provider = provider_for(monkeypatch, kind, counter)
    route = ModelRoute(slot="test", provider=kind, model="fixture",
        credentialSource="platform", maxOutputTokens=128,
        inputPriceMicrousdPerMillion=1, cachedInputPriceMicrousdPerMillion=1,
        outputPriceMicrousdPerMillion=1)
    with pytest.raises(RuntimeError, match="authority"):
        await grounding_evaluator.structured_evaluation(provider, route, "safe", Output,
            "provider-stage", "safe", DefectiveGate(defect), [])
    assert (counter.calls, counter.credits, counter.cost_microusd) == (0, 0, 0)


class NoWriteRedis:
    def __init__(self): self.eval_calls = 0
    async def get(self, _key): return None
    async def eval(self, *_args): self.eval_calls += 1; return []


@pytest.mark.asyncio
@pytest.mark.parametrize("availability,verification,test_center_state", [
    ("available", "Pending", "Isolated enforce"),
    ("unavailable", "PASS", "Isolated enforce"),
    ("available", "PASS", "Unavailable"),
])
async def test_cas_and_runtime_independently_reject_forged_release_state(
        monkeypatch, availability, verification, test_center_state):
    original = test_center.load_json
    def forged(name):
        value = copy.deepcopy(original(name))
        if name == "feature_registry.json":
            feature = next(item for item in value["features"]
                if item["id"] == "evidence-lifecycle-boundary")
            feature["availability"] = availability
            feature["implementationVerification"] = verification
            feature["testCenter"] = test_center_state
            feature["defaultMode"] = "off"
            feature["layers"] = {"capture": "available", "evaluate": "available",
                "project": "available", "enforce": "isolated-test-center"}
        return value
    monkeypatch.setattr(test_center, "load_json", forged)
    meta = original("feature_registry_meta.json")
    update = ControlUpdate(feature_id="evidence-lifecycle-boundary",
        registry_version=meta["registryVersion"], registry_hash=meta["registryHash"],
        expected_revision=0, mode="observe", layers=["capture", "evaluate"])
    redis = NoWriteRedis()
    with pytest.raises(RuntimeError, match="unavailable"):
        await cas_controls(redis, "operator", update)
    with pytest.raises(RuntimeError, match="unavailable"):
        await freeze_control_snapshot(redis, "operator", update.feature_id, "a" * 64)
    with pytest.raises(ValueError, match="unavailable"):
        test_center.run_fixture("lifecycle-nested-secret-blocked", "observe", RUN,
            update.feature_id)
    assert redis.eval_calls == 0
