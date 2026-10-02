import base64
import os
from abc import ABC, abstractmethod

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class KeyWrapper(ABC):
    @abstractmethod
    def unwrap(self, wrapped: str, context: bytes) -> bytes: ...


class LocalMasterKeyWrapper(KeyWrapper):
    """Local-only envelope adapter. Production deployments replace this with cloud KMS."""

    def __init__(self, master_key: str):
        raw = base64.urlsafe_b64decode(master_key.encode())
        if len(raw) not in {16, 24, 32}:
            raise ValueError("MASTER_KEY must be urlsafe-base64 AES key material")
        self.aes = AESGCM(raw)

    def unwrap(self, wrapped: str, context: bytes) -> bytes:
        payload = base64.urlsafe_b64decode(wrapped.encode())
        return self.aes.decrypt(payload[:12], payload[12:], context)


def wrap_for_local_test(secret: bytes, master_key: str, context: bytes) -> str:
    raw = base64.urlsafe_b64decode(master_key.encode())
    nonce = os.urandom(12)
    encrypted = AESGCM(raw).encrypt(nonce, secret, context)
    return base64.urlsafe_b64encode(nonce + encrypted).decode()
