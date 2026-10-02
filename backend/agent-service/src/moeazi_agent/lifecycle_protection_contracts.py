"""Source-bound obligations to reduce exposure; never a resting stop certificate."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .finance_contracts import FinanceError, FinanceScope, StrictFinanceModel, _digest, _hash, _utc, native_int


class ProtectionObligation(StrictFinanceModel):
    schema_version: Literal[1]
    scope: FinanceScope
    run_id: str = Field(min_length=1)
    manifest_hash: str
    protection_order_id: str = Field(min_length=1)
    originating_order_id: str = Field(min_length=1)
    originating_permit_hash: str
    originating_intent_hash: str
    originating_event_hash: str
    instrument_version_id: str = Field(min_length=1)
    location_id: str = Field(min_length=1)
    policy_hash: str
    position_state_hash: str
    position_revision: int = Field(gt=0)
    signed_exposure_units: str
    filled_quantity_units: str
    observed_at_cursor: datetime
    deadline_at_cursor: datetime
    on_rejection: Literal["hold_and_escalate", "request_reduce_only_close"]
    mechanism: Literal["immediate_reduce_only_market"]
    intended_hash: str

    @field_validator("schema_version", mode="before")
    @classmethod
    def version(cls, value):
        if type(value) is not int or value != 1:
            raise FinanceError("Protection obligation requires integer schema version 1")
        return value

    @field_validator("manifest_hash", "originating_permit_hash", "originating_intent_hash",
                     "originating_event_hash", "policy_hash", "position_state_hash", "intended_hash")
    @classmethod
    def hashes(cls, value):
        return _hash(value)

    @field_validator("observed_at_cursor", "deadline_at_cursor")
    @classmethod
    def times(cls, value):
        return _utc(value)

    @model_validator(mode="after")
    def check(self):
        if self.scope.environment != "experiment" or not native_int(self.signed_exposure_units) or \
                native_int(self.filled_quantity_units, positive=True) <= 0 or \
                self.deadline_at_cursor < self.observed_at_cursor or \
                self.intended_hash != _digest("moeazi-protection-obligation-v1",
                    self.model_dump(mode="json", exclude={"intended_hash"})):
            raise FinanceError("Protection obligation has invalid scope, exposure or hash")
        return self


def make_protection_obligation(event, permit, instrument, state, intent, position_revision):
    """Caller supplies an actual folded increasing fill and its resulting exact state."""
    if event.kind != "fill" or permit.action not in {"spot_buy", "perp_open", "perp_increase"} or \
            not intent.protection.required or permit.protection_order_id is not None or \
            event.scope != permit.scope or state.scope != permit.scope or intent.scope != permit.scope or \
            event.run_id != permit.run_id or state.run_id != permit.run_id or intent.run_id != permit.run_id or \
            event.run_manifest_hash != permit.run_manifest_hash or \
            intent.run_manifest_hash != permit.run_manifest_hash or \
            event.order_id != permit.order_id or event.permit_hash != permit.permit_hash or \
            event.client_id != permit.client_id or event.attempt_id != permit.attempt_id or \
            event.order_ordinal != permit.order_ordinal or \
            intent.intent_id != permit.intent_id or intent.intent_hash != permit.intent_hash or \
            intent.protection.policy_hash != permit.policy_hash or \
            state.instrument_version_id != instrument.instrument_version_id or \
            state.instrument_registry_hash != instrument.registry_hash or \
            event.instrument_version_id != instrument.instrument_version_id or \
            permit.instrument_version_id != instrument.instrument_version_id or \
            permit.instrument_registry_hash != instrument.registry_hash or \
            state.quantity_kind != permit.quantity_kind or \
            (native_int(state.signed_quantity_units) > 0) != (permit.side == "buy") or \
            state.location_id != permit.location_id:
        raise FinanceError("Protection obligation differs from increasing source fill")
    identifier = _digest("moeazi-protection-order-id-v1", {
        "scope": permit.scope.model_dump(mode="json"), "runId": permit.run_id,
        "originatingEventHash": event.event_hash})
    body = dict(schema_version=1, scope=permit.scope, run_id=permit.run_id,
        manifest_hash=permit.run_manifest_hash, protection_order_id=identifier,
        originating_order_id=permit.order_id, originating_permit_hash=permit.permit_hash,
        originating_intent_hash=intent.intent_hash, originating_event_hash=event.event_hash,
        instrument_version_id=instrument.instrument_version_id, location_id=permit.location_id,
        policy_hash=permit.policy_hash,
        position_state_hash=_digest("moeazi-position-arithmetic-v1", state.model_dump(mode="json")),
        position_revision=position_revision, signed_exposure_units=state.signed_quantity_units,
        filled_quantity_units=event.fill_quantity_units,
        observed_at_cursor=event.simulation_cursor_at,
        deadline_at_cursor=event.simulation_cursor_at +
            timedelta(seconds=intent.protection.maximum_unprotected_seconds),
        on_rejection=intent.protection.on_rejection, mechanism="immediate_reduce_only_market")
    encoded = ProtectionObligation.model_construct(**body).model_dump(mode="json", exclude={"intended_hash"})
    return ProtectionObligation.model_validate({**body,
        "intended_hash": _digest("moeazi-protection-obligation-v1", encoded)})
