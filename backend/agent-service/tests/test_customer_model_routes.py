"""Saved customer routes must be priced and compatible before billable Research."""

import json

import pytest
from fastapi import HTTPException

from moeazi_agent.evaluation_v2_api import resolve_spec
from moeazi_agent.evaluation_v2_contracts import (
    EvaluationExperimentV2, EvaluationSchedule, EvaluationStageSelection, EvaluationSubjectV2,
)


def _route(slot, *, source="platform", input_price=100_000):
    return {
        "slot": slot, "provider": "deepseek", "model": "deepseek-v4-flash",
        "credentialSource": source, "connectionId": "connection-1" if source == "byok" else None,
        "maxOutputTokens": 700, "inputPriceMicrousdPerMillion": input_price,
        "cachedInputPriceMicrousdPerMillion": 0, "outputPriceMicrousdPerMillion": 200_000,
    }


def _spec():
    return EvaluationExperimentV2(
        name="Saved team", mode="replay", markets=["BTC-USD"],
        subjects=[EvaluationSubjectV2(subject_id="champion", label="Champion", kind="champion",
                                      team_version_id="saved-version-0001", tier="focus",
                                      selected_roles=["technical_trend"], quorum_minimum=1)],
        stages=EvaluationStageSelection(forecast=True), horizons=["1h"], safety_cases=["stale_evidence"],
        schedule=EvaluationSchedule(), confirmed_shadow_only=True,
    )


def _client(monkeypatch, routes, compatible=True):
    class Client:
        def __init__(self, _settings):
            pass

        async def command(self, name, **_kwargs):
            if name == "getProviderOwnerContext":
                return {"strategyAccountId": "account-1"}
            if name == "getOwnedTeamVersion":
                return {"accountId": "account-1", "config": {
                    "markets": ["BTC-USD"], "modelRoutingJson": json.dumps({"schemaVersion": 2, "routes": routes}),
                    "roles": [{"id": "technical_trend", "enabled": True, "horizon": "hours"}],
                    "tier": "focus",
                }}
            if name == "getProviderConnectionForWorker":
                return {"status": "verified", "provider": "deepseek", "capabilitiesJson": json.dumps({
                    "compatibleModels": ["deepseek-v4-flash"] if compatible else [],
                })}
            raise AssertionError(name)

    monkeypatch.setattr("moeazi_agent.evaluation_v2_api.ConvexWorkerClient", Client)


@pytest.mark.asyncio
async def test_unpriced_platform_route_identifies_payer_and_stage(monkeypatch):
    _client(monkeypatch, [_route("specialist_default", input_price=0), _route("synthesis")])
    with pytest.raises(HTTPException) as error:
        await resolve_spec(_spec(), "owner", "team-1")
    assert error.value.status_code == 409
    assert "Specialist default" in error.value.detail
    assert "Moeazi credits" in error.value.detail


@pytest.mark.asyncio
async def test_untested_byok_route_blocks_without_provider_call(monkeypatch):
    _client(monkeypatch, [_route("specialist_default", source="byok"),
                          _route("synthesis", source="byok")], compatible=False)
    with pytest.raises(HTTPException) as error:
        await resolve_spec(_spec(), "owner", "team-1")
    assert error.value.status_code == 409
    assert "compatibility tests may be billable" in error.value.detail


@pytest.mark.asyncio
async def test_verified_compatible_byok_route_can_resolve(monkeypatch):
    _client(monkeypatch, [_route("specialist_default", source="byok"),
                          _route("synthesis", source="byok")])
    result = await resolve_spec(_spec(), "owner", "team-1")
    assert result.subjects[0].routing.route("synthesis").credential_source == "byok"
