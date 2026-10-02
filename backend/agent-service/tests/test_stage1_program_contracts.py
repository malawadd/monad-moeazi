"""Independent frozen managed-program identity checks with no runtime authority."""

import pytest
from pydantic import ValidationError

from moeazi_agent.controller_contracts import version_content_hash
from moeazi_agent.program_contracts import (
    ExperimentSpecIdentity, ProgramAssignment, TradingProgramVersion,
    require_managed_program_runtime,
)


def frozen_version():
    base = {
        "programId": "program-a", "version": 1,
        "sourceStrategyAccountId": "source-a", "teamVersionId": "team-ver-a",
        "modelConfigurationId": "model-a", "policyId": "policy-a",
        "strategyArtifactHash": "a" * 64, "adapterProfileHash": "b" * 64,
        "runtimeCompatibility": "agent-v1",
        "teamConfigJson": '{"tier":"focus"}',
        "modelConfigurationJson": '{"route":"model-a"}',
        "policyJson": '{"limit":100}',
    }
    for label, field in (("teamConfigHash", "teamConfigJson"),
                         ("modelConfigurationHash", "modelConfigurationJson"),
                         ("policyHash", "policyJson")):
        base[label] = version_content_hash({"content": base[field]})
    manifest = {"schemaVersion": 1, "controllerKind": "managed_program",
                **{key: value for key, value in base.items()
                   if key not in {"teamConfigJson", "modelConfigurationJson", "policyJson"}}}
    base["contentHash"] = version_content_hash(manifest)
    return base


def test_frozen_version_rejects_changed_source_content_and_hash():
    raw = frozen_version()
    assert TradingProgramVersion.model_validate(raw).contentHash == raw["contentHash"]
    for changed in (
        {**raw, "teamConfigJson": '{"tier":"max"}'},
        {**raw, "modelConfigurationJson": '{"route":"model-b"}'},
        {**raw, "policyJson": '{"limit":1000}'},
        {**raw, "contentHash": "c" * 64},
        {**raw, "unexpected": "caller data"},
    ):
        with pytest.raises(ValidationError):
            TradingProgramVersion.model_validate(changed)


def test_assignment_requires_exact_controller_for_active_status():
    ref = {"schemaVersion": 1, "environment": "live", "strategyAccountId": "acct-a",
           "controllerKind": "managed_program", "controllerId": "assignment-a",
           "controllerVersionId": "program-ver-a", "contentHash": "d" * 64}
    assignment = {"assignmentId": "assignment-a", "strategyAccountId": "acct-a",
                  "programVersionId": "program-ver-a", "status": "active",
                  "source": "explicit", "controllerRef": ref}
    assert ProgramAssignment.model_validate(assignment).controllerRef.controllerId == "assignment-a"
    for changed in (
        {**assignment, "controllerRef": None},
        {**assignment, "controllerRef": {**ref, "strategyAccountId": "acct-b"}},
        {**assignment, "controllerRef": {**ref, "controllerId": "assignment-b"}},
        {**assignment, "controllerRef": {**ref, "environment": "experiment"}},
    ):
        with pytest.raises(ValidationError):
            ProgramAssignment.model_validate(changed)
    assert ProgramAssignment.model_validate({**assignment, "status": "paused",
                                             "controllerRef": None}).status == "paused"


def test_experiment_identity_cannot_be_live():
    spec = {"createdBySubject": "researcher-a", "controllerKind": "customer_team",
            "controllerVersionId": "team-ver-a", "contentHash": "e" * 64,
            "environment": "experiment", "specJson": "{}"}
    assert ExperimentSpecIdentity.model_validate(spec).environment == "experiment"
    with pytest.raises(ValidationError):
        ExperimentSpecIdentity.model_validate({**spec, "environment": "live"})


def test_managed_runtime_requires_active_exact_assignment_version_and_owner_mode():
    version = frozen_version()
    version_id = "program-version-a"
    assignment_id = "assignment-a"
    ref = {"schemaVersion": 1, "environment": "live", "strategyAccountId": "acct-target",
           "controllerKind": "managed_program", "controllerId": assignment_id,
           "controllerVersionId": version_id, "contentHash": version["contentHash"]}
    assignment = {"assignmentId": assignment_id, "strategyAccountId": "acct-target",
                  "programVersionId": version_id, "status": "active", "source": "explicit"}
    context = {"controllerRef": ref,
               "profile": {"_id": assignment_id, "authorityMode": "shadow"},
               "managedProgram": {"assignment": assignment, "version": version,
                                  "teamConfig": {"roles": [{"id": "liquidity", "enabled": True}]}}}
    job = {"strategyAccountId": "acct-target", "programAssignmentId": assignment_id,
           "programVersionId": version_id, "controllerMode": "shadow", "controllerRef": ref}
    parsed_assignment, parsed_version, parsed_ref, mode = require_managed_program_runtime(job, context)
    assert parsed_assignment.assignmentId == assignment_id
    assert parsed_version.contentHash == version["contentHash"]
    assert parsed_ref == parsed_assignment.controllerRef
    assert mode == "shadow"

    autopilot_assignment = {**assignment, "controllerMode": "autopilot"}
    autopilot_context = {
        **context,
        "profile": {"_id": assignment_id, "authorityMode": "autopilot"},
        "managedProgram": {**context["managedProgram"], "assignment": autopilot_assignment},
    }
    autopilot_job = {**job, "controllerMode": "autopilot"}
    parsed_assignment, _, _, mode = require_managed_program_runtime(autopilot_job, autopilot_context)
    assert parsed_assignment.controllerMode == "autopilot"
    assert mode == "autopilot"

    for changed_context, changed_job in (
        ({**context, "managedProgram": {**context["managedProgram"],
          "assignment": {**assignment, "status": "paused"}}}, job),
        (context, {**job, "programVersionId": "other-version"}),
        ({**context, "profile": {"_id": assignment_id, "authorityMode": "autopilot"}}, job),
        ({**context, "managedProgram": {**context["managedProgram"],
          "assignment": {**assignment, "source": "migration"}}}, job),
        (autopilot_context, job),
    ):
        with pytest.raises((ValidationError, ValueError)):
            require_managed_program_runtime(changed_job, changed_context)
