import json
import logging
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy.ext.asyncio import create_async_engine

from .config import get_settings
from .convex import ConvexCommandError, ConvexWorkerClient
from .provider_catalog import list_models, openrouter_model_details, probe_model, search_models
from .provider_credentials import ProviderSecretVault, zero_secret


router = APIRouter(prefix="/v1/providers", tags=["model providers"])
settings = get_settings()
engine = create_async_engine(settings.postgres_dsn, pool_pre_ping=True)
vault = ProviderSecretVault(settings, engine)
logger = logging.getLogger(__name__)


class ConnectionCreate(BaseModel):
    provider: Literal["openai", "deepseek", "openrouter"]
    label: str = Field(min_length=2, max_length=60)
    api_key: SecretStr


class ConnectionRotate(BaseModel):
    api_key: SecretStr


class ModelProbeRequest(BaseModel):
    model: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")


class PlatformModelQualification(BaseModel):
    model: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")


def provider_error(provider: str, exc: Exception, fallback: str) -> str:
    if provider != "openrouter":
        return fallback
    if "No upstream endpoint supports strict structured output" in str(exc):
        return (
            "This model is available through OpenRouter, but it cannot run an agent role "
            "because no eligible host supports strict structured output."
        )
    status = exc.response.status_code if hasattr(exc, "response") else None
    return {
        401: "OpenRouter rejected this API key.",
        402: "This OpenRouter account has no available balance.",
        429: "OpenRouter rate-limited this request. Try again shortly.",
        503: "No OpenRouter host satisfies the selected model and privacy requirements.",
    }.get(status, fallback)


def authorize(value: str | None, subject: str | None) -> str:
    if value != f"Bearer {settings.worker_shared_secret.get_secret_value()}" or not subject:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not settings.byok_enabled:
        raise HTTPException(status_code=404, detail="BYOK is disabled")
    if (
        settings.byok_secret_backend == "local"
        and not settings.master_key.get_secret_value()
    ):
        raise HTTPException(status_code=503, detail="Local BYOK vault requires MASTER_KEY")
    if settings.byok_secret_backend == "aws_kms" and not settings.byok_aws_kms_key_id:
        raise HTTPException(status_code=503, detail="BYOK vault requires an AWS KMS key")
    return subject


async def details(subject: str, connection_id: str) -> dict:
    row = await ConvexWorkerClient(settings).command(
        "getProviderConnectionForWorker", subject=subject, connectionId=connection_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Provider connection not found")
    return row


async def with_secret(row: dict, operation):
    secret = await vault.retrieve(row["secretRef"])
    try:
        return await operation(secret.decode())
    finally:
        zero_secret(secret)


async def require_provider_owner(client: ConvexWorkerClient, subject: str) -> dict:
    try:
        owner = await client.command("getProviderOwnerContext", subject=subject)
    except ConvexCommandError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not verify your strategy account with Convex. Try again shortly.",
        ) from exc
    if not owner:
        raise HTTPException(
            status_code=409,
            detail="Create a strategy account before connecting a model provider.",
        )
    return owner


@router.get("/platform/status")
async def platform_provider_status(authorization: str | None = Header(default=None)):
    """Credential presence only; never contacts a paid provider or returns a secret."""
    if authorization != f"Bearer {settings.worker_shared_secret.get_secret_value()}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {"providers": {
        "deepseek": {"credentialLoaded": bool(settings.deepseek_api_key.get_secret_value())},
        "openai": {"credentialLoaded": bool(settings.openai_api_key.get_secret_value())},
        "openrouter": {"credentialLoaded": bool(settings.openrouter_api_key.get_secret_value())},
    }, "source": "agent_runtime", "verifiedWithProvider": False}


@router.post("/platform/model-qualification")
async def qualify_platform_model(
    request: PlatformModelQualification, authorization: str | None = Header(default=None),
):
    """Read OpenRouter endpoint support and maximum listed prices, without a model call."""
    if authorization != f"Bearer {settings.worker_shared_secret.get_secret_value()}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    key = settings.openrouter_api_key.get_secret_value()
    if not key:
        raise HTTPException(status_code=409, detail="Moeazi OpenRouter key is not loaded")
    if "/" not in request.model:
        raise HTTPException(status_code=422, detail="OpenRouter model ID requires author/model")
    try:
        detail = await openrouter_model_details(request.model, key, settings)
    except Exception:
        raise HTTPException(status_code=409, detail="OpenRouter model has no qualified structured-output endpoint")
    if not detail["pricingKnown"]:
        raise HTTPException(status_code=409, detail="OpenRouter model prices are unavailable")
    return detail


@router.post("/platform/model-probe")
async def probe_platform_model(
    request: PlatformModelQualification, authorization: str | None = Header(default=None),
):
    """A single operator-triggered paid compatibility call; never retried here."""
    if authorization != f"Bearer {settings.worker_shared_secret.get_secret_value()}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    key = settings.openrouter_api_key.get_secret_value()
    if not key or "/" not in request.model:
        raise HTTPException(status_code=409, detail="Qualified Moeazi OpenRouter key and model required")
    try:
        result = await probe_model("openrouter", request.model, key, settings)
    except Exception:
        raise HTTPException(status_code=409, detail="OpenRouter structured-output probe failed")
    return {"model": request.model, "compatible": True, "usage": result.get("usage", {})}


@router.post("/connections")
async def create_connection(
    request: ConnectionCreate, authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    convex = ConvexWorkerClient(settings)
    await require_provider_owner(convex, subject)
    api_key = request.api_key.get_secret_value()
    try:
        models = await list_models(request.provider, api_key, settings)
        if not models:
            raise RuntimeError("Provider returned no accessible models")
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=provider_error(request.provider, exc, "Provider key could not be verified"),
        ) from exc
    stored = await vault.store(subject, request.provider, api_key)
    stored_models = [] if request.provider == "openrouter" else models
    capabilities = {
        "compatibleModels": [], "modelDetails": {},
        "catalogMode": "remote" if request.provider == "openrouter" else "embedded",
        "catalogCount": len(models),
    }
    payload = {
        "subject": subject, "provider": request.provider, "label": request.label.strip(),
        "secretRef": stored.secret_ref, "keyFingerprint": stored.fingerprint,
        "keyLast4": stored.last4, "modelsJson": json.dumps(stored_models, separators=(",", ":")),
        "capabilitiesJson": json.dumps(capabilities, separators=(",", ":")), "status": "verified",
    }
    try:
        connection_id = await convex.command("recordProviderConnection", **payload)
    except ConvexCommandError as exc:
        await vault.revoke(stored.secret_ref)
        logger.error(
            "Convex rejected a verified provider connection",
            extra={"provider": request.provider, "convex_status": exc.status_code, "reason": str(exc)},
        )
        if "Strategy account not found" in str(exc):
            raise HTTPException(
                status_code=409,
                detail="Your strategy account changed while the provider was being connected. Refresh and try again.",
            ) from exc
        raise HTTPException(
            status_code=502,
            detail="Moeazi could not save this verified connection. No provider key was retained. Try again.",
        ) from exc
    return {
        "connectionId": connection_id, "status": "verified",
        "models": stored_models, "catalogCount": len(models),
    }


@router.get("/connections/{connection_id}/models")
async def refresh_models(
    connection_id: str, authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
    q: str = Query(default="", max_length=80), offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
):
    subject = authorize(authorization, x_moeazi_subject)
    row = await details(subject, connection_id)
    if row["status"] == "revoked":
        raise HTTPException(status_code=409, detail="Provider connection is revoked")
    try:
        models = await with_secret(row, lambda key: list_models(row["provider"], key, settings))
    except Exception as exc:
        await ConvexWorkerClient(settings).command(
            "updateProviderConnection", subject=subject, connectionId=connection_id,
            status="invalid", failureReason=str(exc)[:300],
        )
        raise HTTPException(
            status_code=400,
            detail=provider_error(row["provider"], exc, "Provider model discovery failed"),
        ) from exc
    if row["provider"] != "openrouter":
        await ConvexWorkerClient(settings).command(
            "updateProviderConnection", subject=subject, connectionId=connection_id,
            status="verified", modelsJson=json.dumps(models, separators=(",", ":")),
        )
    filtered = search_models(models, q)
    return {
        "models": filtered[offset:offset + limit], "total": len(filtered),
        "offset": offset, "hasMore": offset + limit < len(filtered),
    }


@router.post("/connections/{connection_id}/probe")
async def test_model(
    connection_id: str, request: ModelProbeRequest,
    authorization: str | None = Header(default=None), x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    row = await details(subject, connection_id)
    try:
        result = await with_secret(
            row, lambda key: probe_model(row["provider"], request.model, key, settings),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=provider_error(row["provider"], exc, "Model failed the structured-output probe"),
        ) from exc
    capabilities = json.loads(row.get("capabilitiesJson") or "{}")
    compatible = set(capabilities.get("compatibleModels") or [])
    compatible.add(request.model)
    capabilities["compatibleModels"] = sorted(compatible)
    if result.get("model"):
        model_details = capabilities.get("modelDetails") or {}
        model_details[request.model] = result["model"]
        capabilities["modelDetails"] = model_details
        selected = json.loads(row.get("modelsJson") or "[]")
        selected = [item for item in selected if item.get("id") != request.model]
        selected.append(result["model"])
    else:
        selected = None
    update = {
        "subject": subject, "connectionId": connection_id, "status": "verified",
        "capabilitiesJson": json.dumps(capabilities, separators=(",", ":")),
    }
    if selected is not None:
        update["modelsJson"] = json.dumps(selected, separators=(",", ":"))
    await ConvexWorkerClient(settings).command("updateProviderConnection", **update)
    return {"compatible": True, "model": request.model, "probe": result}


@router.patch("/connections/{connection_id}")
async def rotate_connection(
    connection_id: str, request: ConnectionRotate,
    authorization: str | None = Header(default=None), x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    current = await details(subject, connection_id)
    api_key = request.api_key.get_secret_value()
    stored = await vault.store(subject, current["provider"], api_key)
    try:
        models = await list_models(current["provider"], api_key, settings)
        if not models:
            raise RuntimeError("Provider returned no accessible models")
    except Exception as exc:
        await vault.revoke(stored.secret_ref)
        raise HTTPException(
            status_code=400,
            detail=provider_error(current["provider"], exc, "Replacement key could not be verified"),
        ) from exc
    stored_models = [] if current["provider"] == "openrouter" else models
    capabilities = {
        "compatibleModels": [], "modelDetails": {},
        "catalogMode": "remote" if current["provider"] == "openrouter" else "embedded",
        "catalogCount": len(models),
    }
    await ConvexWorkerClient(settings).command(
        "updateProviderConnection", subject=subject, connectionId=connection_id,
        status="verified", secretRef=stored.secret_ref, keyFingerprint=stored.fingerprint,
        keyLast4=stored.last4, modelsJson=json.dumps(stored_models, separators=(",", ":")),
        capabilitiesJson=json.dumps(capabilities, separators=(",", ":")),
    )
    await vault.revoke(current["secretRef"])
    return {"connectionId": connection_id, "status": "verified", "models": stored_models}


@router.delete("/connections/{connection_id}")
async def revoke_connection(
    connection_id: str, authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = authorize(authorization, x_moeazi_subject)
    row = await details(subject, connection_id)
    await vault.revoke(row["secretRef"])
    return await ConvexWorkerClient(settings).command(
        "updateProviderConnection", subject=subject, connectionId=connection_id, status="revoked",
    )
