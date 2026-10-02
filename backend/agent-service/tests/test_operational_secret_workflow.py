import inspect

import pytest
from pydantic import ValidationError

from moeazi_agent.operational_secret_workflow import (
    OperationalSecretLifecycleWorkflow, OperationalSecretWorkflowCommand,
)


def body():
    return {"command_id": "osc_" + "1" * 48, "descriptor_id": "osc_" + "2" * 48,
        "operation": "rotate", "target_envelope_version": 2, "target_data_key_version": 2,
        "target_kek_version": 1, "registry_hash": "3" * 64, "control_hash": "4" * 64,
        "request_hash": "5" * 64, "idempotency_key": "workflow:test:1"}


def test_workflow_command_accepts_metadata_only_exact_contract():
    command = OperationalSecretWorkflowCommand.model_validate(body())
    assert command.operation == "rotate"
    for forbidden in ("plaintext", "ciphertext", "wrapped_key", "aad", "credential", "url", "command"):
        if forbidden == "command": continue
        assert forbidden not in command.model_dump()
    with pytest.raises(ValidationError):
        OperationalSecretWorkflowCommand.model_validate({**body(), "url": "https://invalid"})


def test_workflow_is_deliberately_unregistered():
    source = inspect.getsource(OperationalSecretLifecycleWorkflow)
    temporal_app = (inspect.getsourcefile(OperationalSecretLifecycleWorkflow) or "").replace(
        "operational_secret_workflow.py", "temporal_app.py")
    assert "claim_operational_secret_command" in source
    assert "OperationalSecretLifecycleWorkflow" not in open(temporal_app, encoding="utf-8").read()
