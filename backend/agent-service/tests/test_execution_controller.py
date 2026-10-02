import copy

import pytest

from moeazi_agent.execution_controller import require_executable_controller


def managed_context():
    ref = {"schemaVersion": 1, "environment": "live",
           "strategyAccountId": "account-a", "controllerKind": "managed_program",
           "controllerId": "assignment-a", "controllerVersionId": "version-a",
           "contentHash": "a" * 64}
    row = {"controllerRef": ref, "controllerMode": "autopilot",
           "strategyAccountId": "account-a", "programAssignmentId": "assignment-a",
           "programVersionId": "version-a"}
    context = {"controllerRef": ref,
               "profile": {"_id": "assignment-a", "authorityMode": "autopilot"},
               "managedProgram": {
                   "assignment": {"assignmentId": "assignment-a",
                                  "controllerMode": "autopilot"},
                   "version": {"_id": "version-a", "contentHash": "a" * 64}}}
    return row, context


def test_managed_proposal_enters_execution_only_with_exact_active_binding():
    row, context = managed_context()
    require_executable_controller(row, context)
    mutations = [
        ({"programAssignmentId": "another"}, {}),
        ({"programVersionId": "another"}, {}),
        ({"controllerMode": "shadow"}, {}),
        ({}, {"profile": {"_id": "assignment-a", "authorityMode": "shadow"}}),
        ({}, {"managedProgram": {"assignment": {"assignmentId": "assignment-a",
                                              "controllerMode": "shadow"},
                                  "version": {"_id": "version-a",
                                              "contentHash": "a" * 64}}}),
    ]
    for changed_row, changed_context in mutations:
        with pytest.raises(ValueError):
            require_executable_controller({**row, **changed_row},
                {**context, **copy.deepcopy(changed_context)})
