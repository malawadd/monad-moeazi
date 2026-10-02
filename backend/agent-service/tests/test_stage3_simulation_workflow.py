"""Workflow rejection checks; these do not qualify the financial lifecycle."""
from copy import deepcopy

import pytest

from moeazi_agent.simulation_workflow import _checked_result, _checked_control
from moeazi_agent.simulation_workflow_contracts import SimulationControl


RESULT = {"schema_version": 1, "run_id": "run-a", "status": "running",
          "cursor_sequence": 4, "projection_revision": 8, "pending_obligations": True,
          "next_action": "advance", "next_wake_delay_ms": None}


@pytest.mark.parametrize("change", [
    {"run_id": "run-b"}, {"schema_version": True}, {"pending_obligations": "false"},
    {"cursor_sequence": True}, {"cursor_sequence": 2}, {"projection_revision": 6},
    {"cursor_sequence": 3, "projection_revision": 7},
    {"next_action": "completed", "status": "running", "pending_obligations": False},
    {"next_action": "completed", "status": "completed_flat"},
    {"status": "completed_flat", "pending_obligations": False},
    {"next_wake_delay_ms": -1}, {"authority": "live"},
])
def test_progress_cannot_fabricate_completion_or_cross_run(change):
    result = {**deepcopy(RESULT), **change}
    with pytest.raises(ValueError):
        _checked_result(result, 3, 7, "run-a")


def test_flat_without_obligations_is_the_only_terminal_result():
    result = {**RESULT, "status": "completed_flat", "pending_obligations": False,
              "next_action": "completed"}
    assert _checked_result(result, 3, 7, "run-a") == result


def test_stable_control_receipt_keeps_original_revision_and_requires_exact_identity():
    control = SimulationControl(command_id="stop-a", operation="stop_entries")
    receipt = {"commandId": "stop-a", "operation": "stop_entries", "outcome": "applied",
               "projectionRevision": 0}
    assert _checked_control(receipt, control) == receipt
    for change in ({"commandId": "stop-b"}, {"operation": "request_close"},
                   {"outcome": "rejected"}, {"projectionRevision": -1}):
        with pytest.raises(ValueError):
            _checked_control({**receipt, **change}, control)
