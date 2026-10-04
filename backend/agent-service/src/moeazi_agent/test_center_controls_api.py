"""Bounded authenticated control and registry routes for the isolated Test Center."""
from __future__ import annotations
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import Field
from .test_center import ControlUpdate, audit_snapshot, cas_controls, controls_key, feature_is_testable, get_controls, registry_response
from .contracts import StrictModel
class ResetRequest(StrictModel):
    feature_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,79}$"); registry_version: str = Field(min_length=8, max_length=80); registry_hash: str = Field(pattern=r"^[a-f0-9]{64}$"); expected_revision: int = Field(ge=0)
def identity(*args):
    from .test_center_api import identity as authenticate
    return authenticate(*args)
def repository(request):
    from .test_center_api import repository as get_repository
    return get_repository(request)

router = APIRouter(tags=["isolated test center"])
@router.get("/registry")
async def registry(authorization: str|None=Header(default=None), subject: str|None=Header(default=None,alias="X-Moeazi-Subject"), session_id: str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
    identity(authorization,subject,session_id); return registry_response()
@router.get("/state/{feature_id}")
async def state(feature_id: str, request: Request, authorization: str|None=Header(default=None), subject: str|None=Header(default=None,alias="X-Moeazi-Subject"), session_id: str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
    operator=identity(authorization,subject,session_id); feature=next((x for x in registry_response()["features"] if x["id"]==feature_id),None)
    if not feature_is_testable(feature): raise HTTPException(status_code=404,detail="Test Center feature is unavailable")
    return await get_controls(request.app.state.redis,operator,feature_id)
@router.patch("/controls")
async def update_controls(update: ControlUpdate, request: Request, authorization: str|None=Header(default=None), subject: str|None=Header(default=None,alias="X-Moeazi-Subject"), session_id: str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
    operator=identity(authorization,subject,session_id)
    try:
        change=await cas_controls(request.app.state.redis,operator,update)
        try: await repository(request).save_control(operator,update.feature_id,change)
        except Exception: await request.app.state.redis.delete(controls_key(operator,update.feature_id)); raise
        return change["current"]
    except RuntimeError as exc: raise HTTPException(status_code=409,detail=str(exc)) from exc
    except Exception as exc: raise HTTPException(status_code=503,detail="Test Center controls failed safe") from exc
@router.post("/reset")
async def reset_controls(reset: ResetRequest, request: Request, authorization: str|None=Header(default=None), subject: str|None=Header(default=None,alias="X-Moeazi-Subject"), session_id: str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
    operator=identity(authorization,subject,session_id)
    try:
        change=await cas_controls(request.app.state.redis,operator,ControlUpdate(feature_id=reset.feature_id,registry_version=reset.registry_version,registry_hash=reset.registry_hash,expected_revision=reset.expected_revision,mode="off",layers=[]))
        await repository(request).save_control(operator,reset.feature_id,change); return change["current"]
    except RuntimeError as exc: raise HTTPException(status_code=409,detail=str(exc)) from exc
    except Exception as exc:
        await request.app.state.redis.delete(controls_key(operator,reset.feature_id)); raise HTTPException(status_code=503,detail="Test Center reset failed safe") from exc
