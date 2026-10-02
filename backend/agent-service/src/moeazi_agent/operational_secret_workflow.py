from __future__ import annotations

from datetime import timedelta
from typing import Literal

from pydantic import Field
from temporalio import workflow
from temporalio.common import RetryPolicy

from .operational_secret_contracts import Hash, OpaqueId, SecretModel


class OperationalSecretWorkflowCommand(SecretModel):
    schema_version: Literal[1] = 1
    command_id: OpaqueId
    descriptor_id: OpaqueId
    operation: Literal["rotate", "recover", "revoke", "destroy_plan", "readiness_assess"]
    target_envelope_version: int | None = Field(default=None, ge=1)
    target_data_key_version: int | None = Field(default=None, ge=1)
    target_kek_version: int | None = Field(default=None, ge=1)
    registry_hash: Hash
    control_hash: Hash
    request_hash: Hash
    idempotency_key: str = Field(min_length=8, max_length=96, pattern=r"^[A-Za-z0-9._:-]+$")


@workflow.defn
class OperationalSecretLifecycleWorkflow:
    """Metadata-only and intentionally unregistered for the local release."""

    @workflow.run
    async def run(self, raw: dict) -> dict:
        command = OperationalSecretWorkflowCommand.model_validate(raw)
        result = await workflow.execute_activity(
            "claim_operational_secret_command", command.model_dump(mode="json"),
            start_to_close_timeout=timedelta(minutes=1),
            retry_policy=RetryPolicy(maximum_attempts=5),
        )
        allowed = {"commandId", "descriptorId", "operation", "requestHash",
                   "transitionHash", "outcome"}
        if not isinstance(result, dict) or set(result) != allowed:
            raise ValueError("Operational secret activity returned unsafe metadata")
        return result
