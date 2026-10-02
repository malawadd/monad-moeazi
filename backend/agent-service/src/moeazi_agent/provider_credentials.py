import asyncio
import base64
import hashlib
import os
from dataclasses import dataclass
from uuid import uuid4

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .config import Settings


@dataclass(frozen=True)
class StoredProviderSecret:
    secret_ref: str
    fingerprint: str
    last4: str
    kms_key_ref: str


class ProviderSecretVault:
    def __init__(self, settings: Settings, engine: AsyncEngine):
        self.settings = settings
        self.engine = engine

    async def store(self, subject: str, provider: str, api_key: str) -> StoredProviderSecret:
        clean = api_key.strip()
        if len(clean) < 12 or len(clean) > 512 or any(char.isspace() for char in clean):
            raise ValueError("Provider key format is invalid")
        secret_ref = f"provider/{provider}/{uuid4()}"
        subject_hash = _hash(subject)
        ciphertext, key_ref = await self._encrypt(
            clean.encode(), {"secret_ref": secret_ref, "subject_hash": subject_hash},
        )
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO provider_secrets
                  (secret_ref, subject_hash, provider, ciphertext, kms_key_ref, status)
                VALUES (:ref, :subject, :provider, :ciphertext, :key_ref, 'active')
            """), {
                "ref": secret_ref, "subject": subject_hash, "provider": provider,
                "ciphertext": ciphertext, "key_ref": key_ref,
            })
        return StoredProviderSecret(secret_ref, _hash(clean), clean[-4:], key_ref)

    async def retrieve(self, secret_ref: str) -> bytearray:
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT ciphertext, kms_key_ref, subject_hash FROM provider_secrets
                WHERE secret_ref = :ref AND status = 'active'
            """), {"ref": secret_ref})).first()
        if not row:
            raise RuntimeError("Provider credential is unavailable or revoked")
        value = await self._decrypt(
            row.ciphertext, row.kms_key_ref,
            {"secret_ref": secret_ref, "subject_hash": row.subject_hash},
        )
        return bytearray(value)

    async def revoke(self, secret_ref: str) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                UPDATE provider_secrets SET status = 'revoked', revoked_at = now(), updated_at = now()
                WHERE secret_ref = :ref
            """), {"ref": secret_ref})

    async def _encrypt(self, value: bytes, context: dict[str, str]) -> tuple[str, str]:
        if self.settings.byok_secret_backend == "aws_kms":
            if not self.settings.byok_aws_kms_key_id:
                raise RuntimeError("BYOK_AWS_KMS_KEY_ID is required")
            import boto3
            client = boto3.client("kms", region_name=self.settings.byok_aws_region)
            response = await asyncio.to_thread(
                client.encrypt, KeyId=self.settings.byok_aws_kms_key_id,
                Plaintext=value, EncryptionContext=context,
            )
            return base64.b64encode(response["CiphertextBlob"]).decode(), self.settings.byok_aws_kms_key_id
        if self.settings.environment not in {"local", "test"}:
            raise RuntimeError("Production BYOK requires the aws_kms secret backend")
        raw = _local_key(self.settings)
        nonce = os.urandom(12)
        encrypted = AESGCM(raw).encrypt(nonce, value, _aad(context))
        return base64.urlsafe_b64encode(nonce + encrypted).decode(), "local-master"

    async def _decrypt(self, value: str, key_ref: str, context: dict[str, str]) -> bytes:
        if key_ref != "local-master":
            import boto3
            client = boto3.client("kms", region_name=self.settings.byok_aws_region)
            response = await asyncio.to_thread(
                client.decrypt, CiphertextBlob=base64.b64decode(value),
                KeyId=key_ref, EncryptionContext=context,
            )
            return bytes(response["Plaintext"])
        payload = base64.urlsafe_b64decode(value.encode())
        return AESGCM(_local_key(self.settings)).decrypt(payload[:12], payload[12:], _aad(context))


def zero_secret(value: bytearray) -> None:
    for index in range(len(value)):
        value[index] = 0


def _local_key(settings: Settings) -> bytes:
    encoded = settings.master_key.get_secret_value()
    if not encoded:
        raise RuntimeError("MASTER_KEY is required for local BYOK storage")
    raw = base64.urlsafe_b64decode(encoded.encode())
    if len(raw) not in {16, 24, 32}:
        raise RuntimeError("MASTER_KEY must be a urlsafe-base64 AES key")
    return raw


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _aad(context: dict[str, str]) -> bytes:
    return "|".join(f"{key}={context[key]}" for key in sorted(context)).encode()
