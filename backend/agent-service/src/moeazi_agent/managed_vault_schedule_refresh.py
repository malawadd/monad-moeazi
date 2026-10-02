"""Refresh a funded Magic vault's short-lived finance receipt before its cadence run."""
from __future__ import annotations

import re

import httpx


_OWNER = re.compile(r"^0x[0-9a-f]{40}$")
_HASH = re.compile(r"^[0-9a-f]{64}$")


async def refresh_managed_vault_authority(settings, binding: dict | None,
        *, strategy_account_id: str, program_version_id: str) -> bool:
    if not isinstance(binding, dict) or not binding:
        return False
    mandate_id = binding.get("mandateId")
    subject = binding.get("customerSubject")
    owner = binding.get("ownerAddress")
    if (not isinstance(mandate_id, str) or not mandate_id
            or not isinstance(subject, str) or not subject or len(subject) > 512
            or not isinstance(owner, str) or not _OWNER.fullmatch(owner)):
        return False
    try:
        async with httpx.AsyncClient(base_url=settings.agent_api_url, timeout=120) as client:
            response = await client.post(
                "/v1/finance/managed-program/vault-activation-authority",
                json={"mandateId": mandate_id}, headers={
                    "Authorization": "Bearer "
                        + settings.worker_shared_secret.get_secret_value(),
                    "x-moeazi-subject": subject,
                })
        if not response.is_success:
            return False
        proof = response.json()
    except (httpx.HTTPError, ValueError):
        return False
    return (isinstance(proof, dict) and proof.get("status") == "ready"
            and proof.get("mandateId") == mandate_id
            and proof.get("ownerAddress") == owner
            and proof.get("strategyAccountId") == strategy_account_id
            and proof.get("programVersionId") == program_version_id
            and isinstance(proof.get("activationReceiptHash"), str)
            and _HASH.fullmatch(proof["activationReceiptHash"]) is not None)
