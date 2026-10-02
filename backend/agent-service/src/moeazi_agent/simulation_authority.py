"""Fresh product identity eligibility for simulated entries, never native authority."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol

from .controller_contracts import ControllerRef
from .finance_contracts import FinanceError, FinanceScope, _hash
from .lifecycle_state import EntryAuthorizationRequest, EntryAuthorityReceipt


class SimulationContextClient(Protocol):
    async def command(self, command: str, **payload) -> dict | None: ...


@dataclass(frozen=True)
class SimulationIdentity:
    scope: FinanceScope
    controller_ref: ControllerRef
    experiment_request_hash: str
    authority_fingerprint: str
    dataset_hash: str | None


async def require_simulation_identity(
    client: SimulationContextClient, subject: str, experiment_spec_id: str,
) -> SimulationIdentity:
    """Called for new run/entry admission, not as an analysis dependency for exits."""
    if not subject or len(subject) > 512 or not experiment_spec_id or len(experiment_spec_id) > 160:
        raise FinanceError("Authenticated experiment identity is required")
    context = await client.command("getSimulationAuthorityContext", subject=subject,
                                   experimentSpecId=experiment_spec_id)
    if not isinstance(context, dict):
        raise FinanceError("Simulation identity is unavailable")
    try:
        if context["schemaVersion"] != 1 or type(context["schemaVersion"]) is not int \
                or context["authority"] != "simulation_identity_only" \
                or context["liveExecutionAllowed"] is not False \
                or context["entryEligible"] is not True:
            raise ValueError("identity not eligible")
        source_scope = context["scope"]
        scope = FinanceScope(environment=source_scope["environment"],
            scope_id=source_scope["scopeId"], strategy_account_id=source_scope["strategyAccountId"])
        controller = ControllerRef.model_validate(context["controllerRef"])
        if scope.environment != "experiment" or scope.scope_id != experiment_spec_id \
                or controller.environment != "experiment" \
                or controller.controllerId != experiment_spec_id \
                or controller.strategyAccountId != scope.strategy_account_id:
            raise ValueError("identity binding differs")
        request_hash = _hash(context["experimentRequestHash"])
        fingerprint = _hash(context["authorityFingerprint"])
        dataset_hash = context.get("datasetHash")
        if dataset_hash is not None:
            _hash(dataset_hash)
    except (ValueError, TypeError, KeyError) as exc:
        raise FinanceError("Simulation identity is not currently eligible") from exc
    return SimulationIdentity(scope, controller, request_hash, fingerprint, dataset_hash)


class SimulationEntryAuthorizer:
    """Fresh identity check; SQL remains responsible for risk and epoch fencing."""

    def __init__(self, client: SimulationContextClient):
        self._client = client

    async def __call__(self, request: EntryAuthorizationRequest) -> EntryAuthorityReceipt:
        # Include transport latency in the receipt age checked under the SQL lock.
        checked_at = datetime.now(timezone.utc)
        identity = await require_simulation_identity(
            self._client, request.created_by_subject, request.scope.scope_id)
        if identity.scope != request.scope or identity.controller_ref != request.controller_ref \
                or identity.experiment_request_hash != request.experiment_request_hash \
                or identity.authority_fingerprint != request.registered_authority_fingerprint:
            raise FinanceError("Persisted simulation authority has changed")
        return EntryAuthorityReceipt(schema_version=1, scope=identity.scope, run_id=request.run_id,
            controller_ref=identity.controller_ref, controller_mode=request.controller_mode,
            created_by_subject=request.created_by_subject,
            experiment_request_hash=identity.experiment_request_hash,
            authority_fingerprint=identity.authority_fingerprint, checked_at=checked_at)
