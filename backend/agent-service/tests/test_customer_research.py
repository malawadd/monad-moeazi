"""Customer Research must never inherit operator Lab visibility or stale previews."""

from unittest.mock import AsyncMock
from uuid import uuid4
from datetime import datetime, timezone
import os
import json

import pytest
from fastapi import HTTPException

from moeazi_agent import customer_research_api as api
from moeazi_agent.evaluation_customer_cost import summarize_customer_cost, validated_customer_credits
from moeazi_agent.evaluation_v2_storage import EvaluationV2Repository
from moeazi_agent.evidence_lifecycle_evaluator import _validate_shape
from moeazi_agent.grounding_evaluator import structured_evaluation
from moeazi_agent.providers import DeterministicProvider
from moeazi_agent.contracts import SignalReport, SynthesisDraft
from moeazi_agent.evaluation_v2_contracts import (
    EvaluationCreateV2, EvaluationExperimentV2, EvaluationSchedule,
    EvaluationStageSelection, EvaluationSubjectV2, SpendingLimits,
)


def spec():
    return EvaluationExperimentV2(
        name="Customer frozen replay", mode="replay", markets=["BTC-USD"],
        subjects=[EvaluationSubjectV2(
            subject_id="champion", label="Champion", kind="champion",
            tier="focus", selected_roles=["technical_trend", "liquidity"],
            quorum_minimum=2, team_version_id="saved-version-0001",
        )],
        stages=EvaluationStageSelection(forecast=True), horizons=["1h"],
        safety_cases=["stale_evidence"], schedule=EvaluationSchedule(),
        confirmed_shadow_only=True,
    )


def request():
    return EvaluationCreateV2(
        spec=spec(), preview_hash="a" * 64,
        limits=SpendingLimits(
            maximum_per_observation_microusd=100_000,
            maximum_peak_day_microusd=100_000,
            maximum_total_microusd=100_000,
        ),
    )


@pytest.mark.asyncio
async def test_start_rejects_another_teams_preview(monkeypatch):
    repository = AsyncMock()
    repository.preview.return_value = {"customer_team_id": "other-team"}
    monkeypatch.setattr(api, "EvaluationV2Repository", lambda _dsn: repository)
    with pytest.raises(HTTPException) as error:
        await api.start(request(),
                        authorization=f"Bearer {api.settings.worker_shared_secret.get_secret_value()}",
                        x_moeazi_subject="owner", x_moeazi_customer_team="my-team")
    assert error.value.status_code == 409
    repository.create_experiment.assert_not_awaited()


@pytest.mark.asyncio
async def test_start_rejects_preview_drift_before_reservation(monkeypatch):
    repository = AsyncMock()
    repository.preview.return_value = {
        "customer_team_id": "my-team", "customer_account_id": "account",
        "spec": {"changed": True},
    }
    monkeypatch.setattr(api, "EvaluationV2Repository", lambda _dsn: repository)
    monkeypatch.setattr(api, "_owned", AsyncMock(return_value={"accountId": "account"}))
    monkeypatch.setattr(api, "resolve_spec", AsyncMock(return_value=request().spec))
    reserve = AsyncMock()
    monkeypatch.setattr(api, "reserve_complete_plan", reserve)
    with pytest.raises(HTTPException) as error:
        await api.start(request(),
                        authorization=f"Bearer {api.settings.worker_shared_secret.get_secret_value()}",
                        x_moeazi_subject="owner", x_moeazi_customer_team="my-team")
    assert error.value.status_code == 409
    reserve.assert_not_awaited()


@pytest.mark.asyncio
async def test_list_is_bound_to_requested_team(monkeypatch):
    repository = AsyncMock()
    repository.customer_experiments.return_value = []
    monkeypatch.setattr(api, "EvaluationV2Repository", lambda _dsn: repository)
    monkeypatch.setattr(api, "_owned", AsyncMock(return_value={"accountId": "account"}))
    result = await api.list_experiments(
        limit=20, authorization=f"Bearer {api.settings.worker_shared_secret.get_secret_value()}",
        x_moeazi_subject="owner", x_moeazi_customer_team="my-team",
    )
    assert result == {"experiments": []}
    repository.customer_experiments.assert_awaited_once_with("owner", "my-team", 20)


@pytest.mark.asyncio
async def test_preview_and_experiment_binding_in_local_database():
    dsn = os.getenv("MOEAZI_TEST_POSTGRES_DSN")
    if not dsn:
        pytest.skip("Set MOEAZI_TEST_POSTGRES_DSN for local database regression")
    from sqlalchemy import text
    repo = EvaluationV2Repository(dsn)
    owner, team, account = f"test-{uuid4()}", "team-1", "account-1"
    digest = uuid4().hex * 2
    day = datetime.now(timezone.utc).date().isoformat()
    preview = {"previewHash": digest, "maximumCostMicrousd": 1000,
               "expectedCostMicrousd": 500, "dailyMaximums": {day: 1000},
               "maximumCredits": 25}
    experiment_id = str(uuid4())
    legacy_id = str(uuid4())
    try:
        await repo.save_preview(owner, spec(), preview, [], team, account)
        stored = await repo.preview(owner, digest)
        assert stored["customer_team_id"] == team
        assert stored["customer_account_id"] == account
        assert await repo.preview("another-owner", digest) is None
        scheduled = datetime.now(timezone.utc).isoformat()
        item = {"planItemId": str(uuid4()), "kind": "replay", "caseId": "stale_evidence",
                "market": "BTC-USD", "repetition": 0, "scheduledAt": scheduled}
        await repo.create_experiment(experiment_id, owner, spec(), preview, [item], team, account)
        assert await repo.customer_experiment(owner, team, experiment_id)
        plan = await repo.plan(experiment_id)
        assert plan is not None and len(plan[1]) == 1
        await repo.save_allocations(experiment_id, preview["dailyMaximums"])
        await repo.settle_allocations(experiment_id, {day: 0})
        assert await repo.customer_experiment(owner, "another-team", experiment_id) is None
        assert await repo.customer_experiment("another-owner", team, experiment_id) is None
        await repo.create_experiment(legacy_id, owner, spec(), preview, [])
        assert await repo.customer_experiment(owner, team, legacy_id) is None
        assert not any(row["experiment_id"] == legacy_id
                       for row in await repo.customer_experiments(owner, team))
    finally:
        async with repo.engine.begin() as conn:
            await conn.execute(text("DELETE FROM evaluation_budget_allocations WHERE experiment_id=:id"), {"id": experiment_id})
            await conn.execute(text("DELETE FROM evaluation_plan_items WHERE experiment_id=:id"), {"id": experiment_id})
            await conn.execute(text("DELETE FROM evaluation_experiments WHERE experiment_id=:id"), {"id": legacy_id})
            await conn.execute(text("DELETE FROM evaluation_experiments WHERE experiment_id=:id"), {"id": experiment_id})
            await conn.execute(text("DELETE FROM evaluation_previews WHERE preview_hash=:hash"), {"hash": digest})
        await repo.engine.dispose()


@pytest.mark.asyncio
async def test_local_deterministic_specialist_and_synthesis_make_no_external_call():
    class Gate:
        async def __call__(self, _name, payload, _evidence_ids):
            return payload

        async def verify_dispatch(self, _name):
            return None

    provider, gate = DeterministicProvider(), Gate()
    report, usage = await structured_evaluation(
        provider, None, "Market: BTC\nRole: technical_trend", SignalReport,
        "evaluation_technical_trend", "fixture", gate, [],
    )
    draft, synthesis_usage = await structured_evaluation(
        provider, None, "Market: BTC", SynthesisDraft,
        "evaluation_synthesis", "fixture", gate, [],
    )
    assert report.provider == "deterministic"
    assert draft.confidence >= 0
    assert usage.provider_cost_microusd == synthesis_usage.provider_cost_microusd == 0


def test_research_archive_shape_allows_six_reports_but_still_blocks_secrets():
    import json
    content = {"reports": [{f"field_{index}": index for index in range(100)}
                           for _ in range(6)]}
    with pytest.raises(ValueError, match="payload_field_count_exceeded"):
        _validate_shape({"content": json.dumps(content)})
    _validate_shape({"content": json.dumps(content)}, max_depth=16, max_fields=4096)
    content["reports"][0]["api_key"] = "hidden"
    with pytest.raises(PermissionError):
        _validate_shape({"content": json.dumps(content)}, max_depth=16, max_fields=4096)


@pytest.mark.asyncio
async def test_customer_quote_is_scoped_and_never_persists(monkeypatch):
    owned = AsyncMock(return_value={"accountId": "account"})
    planner = AsyncMock(return_value={"maximumCredits": 12})
    monkeypatch.setattr(api, "_owned", owned)
    monkeypatch.setattr(api, "build_preview", planner)
    from moeazi_agent.evaluation_v2_contracts import EvaluationPreviewV2
    result = await api.quote(
        EvaluationPreviewV2(spec=spec(), limits=request().limits),
        authorization=f"Bearer {api.settings.worker_shared_secret.get_secret_value()}",
        x_moeazi_subject="owner", x_moeazi_customer_team="my-team",
    )
    assert result == {"maximumCredits": 12}
    owned.assert_awaited_once_with("owner", "my-team")
    assert planner.await_args.kwargs["persist"] is False
    assert planner.await_args.kwargs["x_moeazi_customer_team"] == "my-team"


def test_customer_research_route_costs_and_validated_settlement():
    plan = {"observationCount": 2, "subjects": [{"subjectId": "champion", "stages": [
        {"stage": "technical_trend", "credentialSource": "platform",
         "expectedMicrousd": 100, "maximumMicrousd": 200},
        {"stage": "liquidity", "credentialSource": "byok",
         "expectedMicrousd": 150, "maximumMicrousd": 300},
        {"stage": "synthesis", "credentialSource": "byok",
         "expectedMicrousd": 250, "maximumMicrousd": 500},
    ]}]}
    cost = summarize_customer_cost(plan)
    assert cost["maximumCredits"] == 12
    assert cost["expectedByokMicrousd"] == 800
    assert cost["maximumByokMicrousd"] == 1600
    runs = [{"subject_id": "champion", "status": "completed", "output": {
        "calls": [{"role": "technical_trend", "status": "completed"},
                  {"role": "liquidity", "status": "completed"},
                  {"role": "synthesis", "status": "completed"}]}},
        {"subject_id": "champion", "status": "failed", "output": {
            "calls": [{"role": "technical_trend", "status": "completed"}]}}]
    assert validated_customer_credits(plan, runs) == 6


@pytest.mark.asyncio
async def test_selected_optional_stage_with_unknown_price_blocks_preview(monkeypatch):
    from moeazi_agent import evaluation_v2_api as planner

    def route(slot, priced=True):
        return {"slot": slot, "provider": "openai", "model": "test-model",
                "credentialSource": "platform", "maxOutputTokens": 250,
                "inputPriceMicrousdPerMillion": 1_000_000 if priced else 0,
                "cachedInputPriceMicrousdPerMillion": 100_000,
                "outputPriceMicrousdPerMillion": 2_000_000 if priced else 0}

    config = {"tier": "focus", "markets": ["BTC-USD"],
              "roles": [{"id": "technical_trend", "enabled": True}],
              "modelRoutingJson": json.dumps({"schemaVersion": 1, "routes": [
                  route("specialist_default"), route("synthesis"), route("forecast", False)]})}

    async def command(_self, name, **_kwargs):
        if name == "getProviderOwnerContext":
            return {"strategyAccountId": "account"}
        if name == "getOwnedTeamVersion":
            return {"accountId": "account", "config": config}
        raise AssertionError(name)

    monkeypatch.setattr(planner.ConvexWorkerClient, "command", command)
    with pytest.raises(HTTPException, match="pricing is unknown") as error:
        await planner.resolve_spec(spec(), "owner", "my-team")
    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_saved_role_instructions_and_horizon_are_frozen_for_research(monkeypatch):
    from moeazi_agent import evaluation_v2_api as planner

    priced = {"provider": "openai", "model": "test-model", "credentialSource": "platform",
              "maxOutputTokens": 250, "inputPriceMicrousdPerMillion": 1_000_000,
              "cachedInputPriceMicrousdPerMillion": 100_000,
              "outputPriceMicrousdPerMillion": 2_000_000}
    config = {"tier": "focus", "markets": ["BTC-USD"],
              "roles": [{"id": "technical_trend", "enabled": True,
                         "horizon": "days", "instructions": "Check support before momentum."}],
              "modelRoutingJson": json.dumps({"schemaVersion": 1, "routes": [
                  {"slot": "specialist_default", **priced}, {"slot": "synthesis", **priced},
                  {"slot": "forecast", **priced}]})}

    async def command(_self, name, **_kwargs):
        if name == "getProviderOwnerContext":
            return {"strategyAccountId": "account"}
        if name == "getOwnedTeamVersion":
            return {"accountId": "account", "config": config}
        raise AssertionError(name)

    monkeypatch.setattr(planner.ConvexWorkerClient, "command", command)
    frozen = await planner.resolve_spec(spec(), "owner", "my-team")
    assert frozen.subjects[0].role_settings[0].instructions == "Check support before momentum."
    assert frozen.subjects[0].role_settings[0].horizon == "days"
    assert "Check support before momentum." in frozen.model_dump_json()
