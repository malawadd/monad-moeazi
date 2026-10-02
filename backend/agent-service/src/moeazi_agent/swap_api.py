import json
import time

import httpx
from fastapi import APIRouter, Header, HTTPException, Request

from .config import get_settings
from .routing_contracts import SwapApprovalRequest, SwapPrepareRequest, SwapQuoteRequest


router = APIRouter(prefix="/v1/swap", tags=["swap"])
settings = get_settings()


def authorize(value: str | None) -> None:
    if value != f"Bearer {settings.worker_shared_secret.get_secret_value()}":
        raise HTTPException(status_code=401, detail="Unauthorized")


async def sidecar(path: str, payload: dict):
    async with httpx.AsyncClient(timeout=settings.routing_timeout_seconds) as client:
        response = await client.post(
            f"{settings.execution_sidecar_url}/internal/uniswap/{path}",
            json=payload,
            headers={"Authorization": f"Bearer {settings.worker_shared_secret.get_secret_value()}"},
        )
    if not response.is_success:
        try:
            detail = response.json().get("error", "Uniswap request failed")
        except Exception:
            detail = "Uniswap request failed"
        raise HTTPException(status_code=409 if path == "swap" else 502, detail=detail)
    return response.json()


@router.post("/quote")
async def quote(request: SwapQuoteRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    payload = {
        "tokenIn": request.token_in,
        "tokenOut": request.token_out,
        "amount": request.amount,
        "type": request.type,
        "tokenInChainId": request.token_in_chain_id,
        "tokenOutChainId": request.token_out_chain_id,
        "swapper": request.swapper,
        "routingPreference": "BEST_PRICE",
    }
    if request.slippage_tolerance is not None:
        payload["slippageTolerance"] = request.slippage_tolerance
    result = await sidecar("quote", payload)
    result["routeSource"] = "trading_api"
    result["moeazi"] = {"chainId": "42161", "quotedAt": int(time.time() * 1000)}
    return result


@router.post("/hook-quote")
async def hook_quote(request: SwapQuoteRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    return await sidecar("hook-quote", {
        "tokenIn": request.token_in,
        "tokenOut": request.token_out,
        "amount": request.amount,
        "swapper": request.swapper,
        "slippageTolerance": request.slippage_tolerance,
    })


@router.post("/check-approval")
async def check_approval(
    request: SwapApprovalRequest,
    http_request: Request,
    authorization: str | None = Header(default=None),
):
    authorize(authorization)
    cache_key = f"swap:approval:42161:{request.wallet_address.lower()}:{request.token.lower()}:{request.amount}"
    cached = await http_request.app.state.redis.get(cache_key)
    if cached:
        return json.loads(cached)
    result = await sidecar("check-approval", {
        "walletAddress": request.wallet_address,
        "token": request.token,
        "amount": request.amount,
        "chainId": 42161,
    })
    await http_request.app.state.redis.setex(cache_key, 30, json.dumps(result))
    return result


@router.post("/prepare")
async def prepare(request: SwapPrepareRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    return await sidecar("swap", request.model_dump(mode="json"))
