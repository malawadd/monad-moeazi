"""Revalidate the exact account controller before a proposal reaches execution."""

from .controller_contracts import (
    require_customer_binding, require_customer_mode,
    require_managed_program_binding,
)


def require_executable_controller(row: dict, context: dict) -> None:
    reference = context["controllerRef"]
    if reference.get("controllerKind") == "managed_program":
        managed = context.get("managedProgram") or {}
        assignment = managed.get("assignment") or {}
        version = managed.get("version") or {}
        if (row.get("controllerMode") != "autopilot"
                or context["profile"].get("authorityMode") != "autopilot"
                or assignment.get("controllerMode") != "autopilot"
                or not assignment.get("assignmentId")
                or not version.get("_id") or not version.get("contentHash")):
            raise ValueError("Managed proposal is not an active Autopilot assignment")
        require_managed_program_binding(
            row, reference, assignment_id=assignment["assignmentId"],
            program_version_id=version["_id"],
            content_hash=version["contentHash"],
        )
    else:
        require_customer_binding(row, reference,
            team_id=context["profile"]["_id"])
    require_customer_mode(row, context["profile"]["authorityMode"])
