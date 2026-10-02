"""Gateway-only retrieval of encrypted, scoped venue credentials."""

from __future__ import annotations

import re

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator


ADDRESS = re.compile(r"^0x[0-9a-f]{40}$")


class HyperliquidCredentialScope(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    strategyAccountId: str = Field(min_length=1)
    venueAccountId: str = Field(min_length=1)
    targetAddress: str
    masterAddress: str
    targetKind: str
    apiWalletAddress: str
    encryptedEnvelope: str = Field(min_length=1)
    kmsKeyRef: str = Field(min_length=1)
    keyVersion: int = Field(ge=1)
    credentialContext: str
    permissionExpiresAt: int = Field(gt=0)
    limitsJson: str = Field(min_length=1)

    @model_validator(mode="after")
    def exact_binding(self):
        for value in (self.targetAddress, self.masterAddress, self.apiWalletAddress):
            if not ADDRESS.fullmatch(value):
                raise ValueError("credential account address is invalid")
        if self.targetKind not in {"master", "subaccount"}:
            raise ValueError("credential target kind is invalid")
        if (self.targetKind == "master") != (self.targetAddress == self.masterAddress):
            raise ValueError("credential target and master disagree")
        expected = (f"venue-credential:v1:{self.strategyAccountId}:hyperliquid:"
                    f"{self.apiWalletAddress}")
        if self.credentialContext != expected:
            raise ValueError("credential encryption context is invalid")
        return self


class GatewayCredentialClient:
    def __init__(self, url: str, secret: str):
        if not url.startswith("https://") and not url.startswith("http://localhost:") \
                and not url.startswith("http://host.docker.internal:"):
            raise ValueError("credential endpoint must use HTTPS or a local development host")
        if len(secret) < 32:
            raise ValueError("gateway credential secret is unavailable")
        self.url, self.secret = url, secret

    async def hyperliquid(self, strategy_account_id: str, venue_account_id: str,
                          target_address: str) -> HyperliquidCredentialScope:
        if not ADDRESS.fullmatch(target_address):
            raise ValueError("target address is invalid")
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(self.url,
                headers={"Authorization": f"Bearer {self.secret}"},
                json={"venue": "hyperliquid", "strategyAccountId": strategy_account_id,
                      "venueAccountId": venue_account_id, "targetAddress": target_address})
        if response.status_code != 200:
            raise RuntimeError("gateway credential authority is unavailable")
        scope = HyperliquidCredentialScope.model_validate(response.json())
        if scope.strategyAccountId != strategy_account_id \
                or scope.venueAccountId != venue_account_id \
                or scope.targetAddress != target_address:
            raise RuntimeError("gateway credential scope differs from request")
        return scope
