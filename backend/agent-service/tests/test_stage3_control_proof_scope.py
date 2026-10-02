"""A terminal control cannot borrow a hash-valid permit from another run."""
from datetime import timedelta

import pytest

from moeazi_agent.controller_contracts import ControllerRef
from moeazi_agent.finance_contracts import FinanceError, FinanceScope
from moeazi_agent.lifecycle_control_proofs import terminal_order_fact
from test_stage3_lifecycle_contracts import H, T, event, permit


class _Rows:
    def __init__(self, value):
        self.value = value

    def scalar_one(self):
        return self.value

    def mappings(self):
        return self

    def all(self):
        return self.value


class _StoredProof:
    def __init__(self, fact):
        self.fact = fact

    async def execute(self, statement, _parameters):
        sql = str(statement)
        if "FROM finance_reservations" in sql:
            return _Rows("settled")
        if "FROM simulation_order_events" in sql:
            return _Rows([{"event_hash": self.fact.event_hash,
                "event_json": self.fact.model_dump(mode="json"),
                "event_kind": self.fact.kind, "transaction_id": "journal-1"}])
        raise AssertionError("unexpected proof read")


def _order(bound_permit):
    return {"environment": "experiment", "scope_id": "spec-a",
            "strategy_account_id": "account-a", "run_id": "run-a",
            "status": "filled", "permit_json": bound_permit.model_dump(mode="json"),
            "permit_hash": bound_permit.permit_hash, "order_id": "order-a",
            "order_ordinal": 1, "intent_id": "intent-a", "intent_hash": H,
            "client_id": "client-a", "attempt_id": "attempt-a",
            "reservation_id": "reserve-a", "cumulative_filled_units": "10000000",
            "quantity_units": "10000000", "normalized_payload_hash": H,
            "instrument_version_id": "btc-spot-v1", "action": "spot_buy",
            "side": "buy", "quantity_kind": "asset_native"}


PARAMS = {"environment": "experiment", "scope_id": "spec-a",
          "strategy_account_id": "account-a", "run_id": "run-a",
          "manifest_hash": H, "cursor": T + timedelta(milliseconds=10)}


@pytest.mark.asyncio
@pytest.mark.parametrize("mismatch", ["foreign_scope", "foreign_run", "foreign_manifest"])
async def test_terminal_control_rejects_hash_valid_foreign_permit(mismatch):
    changes = {}
    if mismatch == "foreign_scope":
        changes["scope"] = FinanceScope(environment="experiment", scope_id="spec-b",
                                        strategy_account_id="account-b")
        changes["controller_ref"] = ControllerRef(schemaVersion=1,
            environment="experiment", strategyAccountId="account-b",
            controllerKind="customer_team", controllerId="spec-b",
            controllerVersionId="version-b", contentHash=H)
    elif mismatch == "foreign_run":
        changes["run_id"] = "run-b"
    else:
        changes["run_manifest_hash"] = "b" * 64
    foreign = permit(**changes)
    own_event = event(permit_hash=foreign.permit_hash,
                      run_manifest_hash=foreign.run_manifest_hash)
    with pytest.raises(FinanceError, match="permit|scope|run"):
        await terminal_order_fact(_StoredProof(own_event), PARAMS, _order(foreign))


@pytest.mark.asyncio
async def test_terminal_control_accepts_exact_owned_folded_fill_only():
    owned = permit()
    fact = event(permit_hash=owned.permit_hash)
    assert await terminal_order_fact(_StoredProof(fact), PARAMS,
                                     _order(owned)) == fact


@pytest.mark.asyncio
@pytest.mark.parametrize("mismatch", ["settled_other_reservation", "short_order_quantity"])
async def test_terminal_control_cannot_borrow_a_settled_hold_or_smaller_order(mismatch):
    owned = permit()
    order = _order(owned)
    fact_changes = {"permit_hash": owned.permit_hash}
    if mismatch == "settled_other_reservation":
        order["reservation_id"] = "settled-other"
    else:
        order["quantity_units"] = order["cumulative_filled_units"] = "5000000"
        fact_changes.update(fill_quantity_units="5000000",
                            cumulative_filled_units="5000000")
    with pytest.raises(FinanceError, match="permit|reservation|quantity"):
        await terminal_order_fact(_StoredProof(event(**fact_changes)), PARAMS, order)


@pytest.mark.asyncio
async def test_terminal_control_rejects_changed_normalized_order_payload():
    owned = permit()
    order = _order(owned)
    order["normalized_payload_hash"] = "b" * 64
    fact = event(permit_hash=owned.permit_hash)
    with pytest.raises(FinanceError, match="permit|payload"):
        await terminal_order_fact(_StoredProof(fact), PARAMS, order)


@pytest.mark.asyncio
@pytest.mark.parametrize("foreign_protection", [False, True])
async def test_protective_rejection_requires_exact_reduction_identity(foreign_protection):
    owned = permit(action="spot_sell", side="sell", protection_order_id="order-a",
                   originating_order_id="original-entry")
    order = {**_order(owned), "status": "rejected", "cumulative_filled_units": "0",
             "action": "spot_sell", "side": "sell"}
    fact = event(permit_hash=owned.permit_hash, kind="protection_rejected",
        protection_order_id="other-protection" if foreign_protection else "order-a",
        cumulative_filled_units="0", fill_quantity_units=None, price_numerator=None,
        price_denominator=None, fee_asset_unit_id=None, fee_registry_hash=None,
        fee_units=None, observation_hash=None)
    if foreign_protection:
        with pytest.raises(FinanceError, match="proof differs"):
            await terminal_order_fact(_StoredProof(fact), PARAMS, order)
    else:
        assert await terminal_order_fact(_StoredProof(fact), PARAMS, order) == fact
