from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel
from temporalio.exceptions import WorkflowAlreadyStartedError

from .config import get_settings
from .venue_setup_workflow import VenueSetupWorkflow


router = APIRouter(prefix="/v1/venues", tags=["venue-setup"])
settings = get_settings()


class BeginRequest(BaseModel):
    attempt_id: str
    workflow_id: str
    venue: str


class ProofRequest(BaseModel):
    reference: str


class VerificationRequest(BaseModel):
    verified: bool
    error: str | None = None
    finalization: dict | None = None


def authorize(value: str | None) -> None:
    if value != f"Bearer {settings.worker_shared_secret.get_secret_value()}":
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.post("/setup")
async def begin(request: BeginRequest, http_request: Request, authorization: str | None = Header(default=None)):
    authorize(authorization)
    if not settings.mainnet_venue_setup_enabled:
        raise HTTPException(status_code=423, detail="Mainnet venue setup environment gate is closed")
    try:
        await http_request.app.state.temporal.start_workflow(
            VenueSetupWorkflow.run,
            {"attempt_id": request.attempt_id, "venue": request.venue},
            id=request.workflow_id,
            task_queue=settings.temporal_task_queue,
        )
        return {"workflowId": request.workflow_id, "status": "started"}
    except WorkflowAlreadyStartedError:
        return {"workflowId": request.workflow_id, "status": "already_started"}


@router.post("/setup/{workflow_id}/proof")
async def proof(workflow_id: str, request: ProofRequest, http_request: Request, authorization: str | None = Header(default=None)):
    authorize(authorization)
    await http_request.app.state.temporal.get_workflow_handle(workflow_id).signal(
        VenueSetupWorkflow.submit_user_proof, request.reference,
    )
    return {"workflowId": workflow_id, "status": "verifying"}


@router.post("/setup/{workflow_id}/verification")
async def verification(workflow_id: str, request: VerificationRequest, http_request: Request, authorization: str | None = Header(default=None)):
    authorize(authorization)
    if request.verified:
        raise HTTPException(
            status_code=409,
            detail="A worker-supplied verified flag is not venue proof; use a protocol-specific verifier.",
        )
    await http_request.app.state.temporal.get_workflow_handle(workflow_id).signal(
        VenueSetupWorkflow.verification_completed, request.model_dump(mode="json"),
    )
    return {"workflowId": workflow_id, "status": "verification_recorded"}
