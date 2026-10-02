"""Hyperliquid agent binding and credential intake inside gateway custody."""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import time
from typing import Literal
from uuid import uuid4

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field, SecretStr
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import get_settings
from .convex import ConvexCommandError, ConvexWorkerClient


router = APIRouter(prefix="/v1/venues/hyperliquid", tags=["hyperliquid credentials"])
settings = get_settings()
INFO_URL = "https://api.hyperliquid.xyz/info"
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
CHALLENGE_TTL_SECONDS = 300


class BindingChallengeRequest(BaseModel):
    attempt_id: str
    master_address: str
    target_kind: Literal["master", "subaccount"]
    target_address: str
    api_wallet_address: str


class CredentialRegistrationRequest(BaseModel):
    attempt_id: str
    challenge_id: str
    owner_signature: str = Field(min_length=130, max_length=132)
    api_wallet_private_key: SecretStr = Field(min_length=64, max_length=66)


def authorize(value: str | None) -> None:
    if value != f"Bearer {settings.worker_shared_secret.get_secret_value()}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not settings.mainnet_venue_setup_enabled:
        raise HTTPException(status_code=423, detail="Mainnet venue setup environment gate is closed")


def normalize_address(value: str) -> str:
    if not ADDRESS.fullmatch(value):
        raise HTTPException(status_code=400, detail="A valid Hyperliquid address is required")
    return value.lower()


def challenge_message(data: dict) -> str:
    return "\n".join((
        "Moeazi Hyperliquid account binding",
        "Version: 1",
        f"Setup attempt: {data['attempt_id']}",
        f"Strategy account: {data['strategy_account_id']}",
        f"Master address: {data['master_address']}",
        f"Target kind: {data['target_kind']}",
        f"Target address: {data['target_address']}",
        f"API wallet address: {data['api_wallet_address']}",
        f"Nonce: {data['nonce']}",
        f"Expires at: {data['expires_at']}",
    ))


async def binding_context(attempt_id: str) -> dict:
    try:
        context = await ConvexWorkerClient(settings).command(
            "getHyperliquidBindingContext", attemptId=attempt_id,
        )
    except ConvexCommandError as exc:
        raise HTTPException(status_code=409, detail="Hyperliquid setup attempt is unavailable") from exc
    if not context or context.get("venue") != "hyperliquid":
        raise HTTPException(status_code=404, detail="Hyperliquid setup attempt was not found")
    if context.get("state") != "verifying" or context.get("authorityMode") not in {"approval", "autopilot"}:
        raise HTTPException(status_code=409, detail="Hyperliquid binding requires the current Approval or Autopilot setup attempt")
    return context


@router.post("/binding-challenge")
async def create_binding_challenge(
    request: BindingChallengeRequest, http_request: Request,
    authorization: str | None = Header(default=None),
):
    authorize(authorization)
    context = await binding_context(request.attempt_id)
    master = normalize_address(request.master_address)
    target = normalize_address(request.target_address)
    agent = normalize_address(request.api_wallet_address)
    if master != context["ownerAddress"].lower():
        raise HTTPException(status_code=409, detail="Hyperliquid master must match the connected account owner")
    if request.target_kind == "master" and target != master:
        raise HTTPException(status_code=400, detail="A master scope must target the master address")
    if request.target_kind == "subaccount" and target == master:
        raise HTTPException(status_code=400, detail="A subaccount scope must target a distinct subaccount")
    now = int(time.time() * 1000)
    data = {
        "attempt_id": request.attempt_id,
        "strategy_account_id": context["strategyAccountId"],
        "master_address": master,
        "target_kind": request.target_kind,
        "target_address": target,
        "api_wallet_address": agent,
        "nonce": base64.urlsafe_b64encode(os.urandom(24)).decode().rstrip("="),
        "expires_at": now + CHALLENGE_TTL_SECONDS * 1000,
    }
    challenge_id = f"hl-bind:{uuid4()}"
    saved = await http_request.app.state.redis.set(
        f"hyperliquid:binding:{challenge_id}", json.dumps(data), ex=CHALLENGE_TTL_SECONDS, nx=True,
    )
    if not saved:
        raise HTTPException(status_code=503, detail="Could not issue a binding challenge")
    return {
        "challengeId": challenge_id,
        "message": challenge_message(data),
        "expiresAt": data["expires_at"],
        "requiredSigner": master,
    }


async def info_query(client: httpx.AsyncClient, kind: str, user: str):
    response = await client.post(INFO_URL, json={"type": kind, "user": user})
    response.raise_for_status()
    return response.json()


def validate_live_binding(api_role: dict, target_role: dict, extra_agents: list,
                          master: str, target: str, target_kind: str, agent: str, now_ms: int) -> dict:
    if (target_kind == "master" and target != master) or (target_kind == "subaccount" and target == master):
        raise HTTPException(status_code=409, detail="Hyperliquid target does not match the requested scope")
    if not isinstance(api_role, dict) or api_role.get("role") != "agent":
        raise HTTPException(status_code=409, detail="API wallet is not registered as a Hyperliquid agent")
    if str(api_role.get("data", {}).get("user", "")).lower() != master:
        raise HTTPException(status_code=409, detail="Hyperliquid API wallet is bound to a different master")
    expected_role = "user" if target_kind == "master" else "subAccount"
    if not isinstance(target_role, dict) or target_role.get("role") != expected_role:
        raise HTTPException(status_code=409, detail="Hyperliquid target account role does not match the requested scope")
    if target_kind == "subaccount" and str(target_role.get("data", {}).get("master", "")).lower() != master:
        raise HTTPException(status_code=409, detail="Hyperliquid subaccount belongs to a different master")
    if not isinstance(extra_agents, list):
        raise HTTPException(status_code=502, detail="Hyperliquid returned malformed agent authority data")
    match = next((row for row in extra_agents if isinstance(row, dict)
                  and str(row.get("address", "")).lower() == agent), None)
    if not match:
        raise HTTPException(status_code=409, detail="API wallet is absent from the master's authorized agents")
    valid_until = match.get("validUntil")
    if not isinstance(valid_until, int) or valid_until <= now_ms:
        raise HTTPException(status_code=409, detail="Hyperliquid API-wallet authorization expiry is absent or expired")
    return {"apiWalletRole": api_role, "targetRole": target_role,
            "extraAgent": {"address": agent, "validUntil": valid_until}}


def encrypt_credential(secret: bytes, context: str) -> tuple[str, str]:
    if settings.byok_secret_backend == "aws_kms":
        if not settings.byok_aws_kms_key_id:
            raise HTTPException(status_code=503, detail="Hyperliquid credential KMS key is not configured")
        import boto3
        client = boto3.client("kms", region_name=settings.byok_aws_region)
        response = client.encrypt(KeyId=settings.byok_aws_kms_key_id, Plaintext=secret,
                                  EncryptionContext={"context": context})
        return base64.b64encode(response["CiphertextBlob"]).decode(), settings.byok_aws_kms_key_id
    if settings.environment not in {"local", "test"}:
        raise HTTPException(status_code=503, detail="Production Hyperliquid credential storage requires KMS")
    encoded = settings.master_key.get_secret_value()
    if not encoded:
        raise HTTPException(status_code=503, detail="Local Hyperliquid credential storage requires MASTER_KEY")
    raw = base64.urlsafe_b64decode(encoded.encode())
    if len(raw) not in {16, 24, 32}:
        raise HTTPException(status_code=503, detail="Local MASTER_KEY is invalid")
    nonce = os.urandom(12)
    payload = AESGCM(raw).encrypt(nonce, secret, context.encode())
    return base64.urlsafe_b64encode(nonce + payload).decode(), "local-master"


@router.post("/credentials")
async def register_credential(
    request: CredentialRegistrationRequest, http_request: Request,
    authorization: str | None = Header(default=None),
):
    authorize(authorization)
    redis_key = f"hyperliquid:binding:{request.challenge_id}"
    stored = await http_request.app.state.redis.getdel(redis_key)
    if not stored:
        raise HTTPException(status_code=409, detail="Binding challenge expired or was already used")
    data = json.loads(stored)
    if request.attempt_id != data["attempt_id"]:
        raise HTTPException(status_code=403, detail="Binding challenge belongs to a different setup attempt")
    if int(data["expires_at"]) <= int(time.time() * 1000):
        raise HTTPException(status_code=409, detail="Binding challenge expired")
    context = await binding_context(data["attempt_id"])
    if context["strategyAccountId"] != data["strategy_account_id"]:
        raise HTTPException(status_code=409, detail="Strategy account changed during binding")
    key_text = request.api_wallet_private_key.get_secret_value().strip()
    if key_text.startswith("0x"):
        key_text = key_text[2:]
    try:
        secret = bytearray.fromhex(key_text)
    except ValueError as exc:
        request.api_wallet_private_key = SecretStr("")
        raise HTTPException(status_code=400, detail="API-wallet key format is invalid") from exc
    if len(secret) != 32:
        for index in range(len(secret)):
            secret[index] = 0
        request.api_wallet_private_key = SecretStr("")
        raise HTTPException(status_code=400, detail="API-wallet key format is invalid")
    try:
        try:
            api_address = Account.from_key(bytes(secret)).address.lower()
            signer = Account.recover_message(
                encode_defunct(text=challenge_message(data)), signature=request.owner_signature,
            ).lower()
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Owner signature or API-wallet key is invalid") from exc
        if signer != data["master_address"]:
            raise HTTPException(status_code=403, detail="Owner signature does not match the Hyperliquid master")
        if api_address != data["api_wallet_address"]:
            raise HTTPException(status_code=400, detail="API-wallet key does not match the challenged address")
        now_ms = int(time.time() * 1000)
        try:
            async with httpx.AsyncClient(timeout=12) as client:
                api_role, target_role, extra_agents = await asyncio.gather(
                    info_query(client, "userRole", api_address),
                    info_query(client, "userRole", data["target_address"]),
                    info_query(client, "extraAgents", data["master_address"]),
                )
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Hyperliquid Info verification is unavailable") from exc
        validate_live_binding(
            api_role, target_role, extra_agents, data["master_address"],
            data["target_address"], data["target_kind"], api_address, now_ms,
        )
        credential_context = f"venue-credential:v1:{data['strategy_account_id']}:hyperliquid:{api_address}"
        envelope, key_ref = await asyncio.to_thread(encrypt_credential, bytes(secret), credential_context)
        try:
            registration = await ConvexWorkerClient(settings).command(
                "registerHyperliquidCredentialBinding", attemptId=data["attempt_id"],
                masterAddress=data["master_address"], targetAddress=data["target_address"],
                targetKind=data["target_kind"], apiWalletAddress=api_address,
                encryptedEnvelope=envelope, kmsKeyRef=key_ref, keyVersion=1,
                credentialContext=credential_context, nonce=data["nonce"],
                expiresAt=data["expires_at"], ownerSignature=request.owner_signature,
            )
        except ConvexCommandError as exc:
            raise HTTPException(status_code=409, detail="Hyperliquid credential could not be registered") from exc
        return {"credentialId": registration["credentialId"], "venueAccountId": registration["venueAccountId"],
                "protocolBinding": "verified", "status": "authorization_required", "routingEnabled": False,
                "targetKind": data["target_kind"], "targetAddress": data["target_address"]}
    finally:
        for index in range(len(secret)):
            secret[index] = 0
        request.api_wallet_private_key = SecretStr("")
