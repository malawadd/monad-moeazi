from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Callable, Protocol, TypeVar

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .operational_secret_contracts import (
    OperationalSecretDescriptor, SecretAccessReceipt, SecretAccessRequest, SecretHandle,
    WrappedSecretEnvelope, canonical_json, digest, with_hash,
)
from .operational_secret_evaluator import envelope_metadata, evaluate_access
from .operational_secret_registry import policy_for

T = TypeVar("T")


class ReceiptWriter(Protocol):
    async def persist_authorization(self, decision, receipt: SecretAccessReceipt) -> None: ...
    async def append_terminal(self, receipt: SecretAccessReceipt) -> None: ...


class FakeVault:
    """Local fixture boundary. Ciphertext and fake KEKs never leave this object."""

    def __init__(self, *, environment: str, frozen_lease: bool, development_gates_closed: bool,
                 fixture_id: str, fake_keks: dict[int, bytes]):
        if environment not in {"local", "development", "test"} or not frozen_lease \
                or not development_gates_closed or not fixture_id.startswith("osc-"):
            raise RuntimeError("Fake vault is available only to a frozen safe local fixture")
        if not fake_keks or any(len(key) != 32 for key in fake_keks.values()):
            raise ValueError("Fake KEKs must be versioned AES-256 fixture keys")
        self.__keks = dict(fake_keks)
        self.__descriptors: dict[str, OperationalSecretDescriptor] = {}
        self.__envelopes: dict[tuple[str, int], WrappedSecretEnvelope] = {}
        self.__used: set[str] = set()
        self.fixture_id = fixture_id

    def store_fixture(self, descriptor: OperationalSecretDescriptor, plaintext: bytes,
                      expires_at: datetime, *, data_nonce: bytes | None = None,
                      wrap_nonce: bytes | None = None) -> SecretHandle:
        policy = policy_for(descriptor.class_id)
        if policy.owner_material_rule == "reject":
            raise ValueError("Owner material is categorically forbidden")
        if descriptor.kek_version not in self.__keks:
            raise ValueError("Unknown fake KEK version")
        if expires_at.tzinfo != timezone.utc or expires_at <= datetime.now(timezone.utc):
            raise ValueError("Fixture envelope expiry must be future UTC")
        if (data_nonce is None) != (wrap_nonce is None):
            raise ValueError("Both fixture nonces must be supplied together")
        data_nonce, wrap_nonce = data_nonce or os.urandom(12), wrap_nonce or os.urandom(12)
        if len(data_nonce) != 12 or len(wrap_nonce) != 12 or data_nonce == wrap_nonce:
            raise ValueError("AES-GCM nonces must be separate 12-byte values")
        aad = canonical_json(envelope_metadata(descriptor, expires_at))
        dek = os.urandom(32)
        ciphertext = AESGCM(dek).encrypt(data_nonce, plaintext, aad)
        wrapped = AESGCM(self.__keks[descriptor.kek_version]).encrypt(wrap_nonce, dek, aad)
        envelope = WrappedSecretEnvelope(descriptor_id=descriptor.descriptor_id,
            tenant_scope=descriptor.tenant_scope, class_id=descriptor.class_id,
            policy_hash=descriptor.policy_hash, envelope_version=descriptor.envelope_version,
            data_key_version=descriptor.data_key_version, kek_version=descriptor.kek_version,
            ciphertext=ciphertext, wrapped_dek=wrapped, data_nonce=data_nonce,
            wrap_nonce=wrap_nonce, aad_hash=digest(envelope_metadata(descriptor, expires_at)),
            state="active", expires_at=expires_at)
        self.__descriptors[descriptor.descriptor_id] = descriptor
        self.__envelopes[(descriptor.descriptor_id, descriptor.envelope_version)] = envelope
        return SecretHandle(descriptor_id=descriptor.descriptor_id,
                            envelope_version=descriptor.envelope_version)

    async def access(self, handle: SecretHandle, request: SecretAccessRequest, writer: ReceiptWriter,
                     callback: Callable[[memoryview], T], now: datetime) -> T:
        descriptor = self.__descriptors.get(handle.descriptor_id)
        envelope = self.__envelopes.get((handle.descriptor_id, handle.envelope_version))
        if not descriptor or not envelope:
            raise PermissionError("Unknown opaque secret reference")
        if request.descriptor_id != handle.descriptor_id:
            raise PermissionError("Secret descriptor reference is invalid")
        if request.idempotency_key in self.__used:
            raise PermissionError("Terminal secret reference cannot be reused")
        if now >= envelope.expires_at: raise PermissionError("Secret envelope is stale")
        if envelope.state != "active": raise PermissionError("Secret envelope is disabled")
        if envelope.kek_version not in self.__keks: raise PermissionError("Fake KEK unavailable")
        expected_aad = envelope_metadata(descriptor, envelope.expires_at)
        if request.aad_hash != digest(expected_aad) or envelope.aad_hash != request.aad_hash:
            raise PermissionError("Secret envelope AAD mismatch")
        safe_envelope_hash = digest({**expected_aad, "state": envelope.state})
        decision = evaluate_access(request, descriptor, policy_for(descriptor.class_id),
                                   safe_envelope_hash, now)
        if decision.outcome != "allow": raise PermissionError(decision.reasons[0])
        attempt_body = {"schema_version": 1,
            "receipt_id": f"osr_{digest({'decision': decision.decision_hash, 'stage': 1})[:48]}",
            "tenant_scope": request.tenant_scope, "descriptor_id": request.descriptor_id,
            "class_id": request.class_id, "purpose": request.purpose,
            "consumer_id": request.consumer_id, "consumer_version": request.consumer_version,
            "capability": request.capability, "envelope_version": request.envelope_version,
            "aad_hash": request.aad_hash, "policy_hash": request.policy_hash,
            "decision_hash": decision.decision_hash, "request_hash": request.request_hash,
            "idempotency_key": request.idempotency_key, "stage": "authorized_attempt",
            "outcome": "authorized", "reason": "authorized", "sequence": 1,
            "occurred_at": now}
        await writer.persist_authorization(decision,
            with_hash(SecretAccessReceipt, "receipt_hash", **attempt_body))
        # Claim before decrypting. A terminal receipt outage is uncertainty, never
        # permission to release this plaintext to a retrying callback.
        self.__used.add(request.idempotency_key)
        aad = canonical_json(expected_aad)
        buffer = None
        try:
            dek = AESGCM(self.__keks[envelope.kek_version]).decrypt(
                envelope.wrap_nonce, envelope.wrapped_dek, aad)
            buffer = bytearray(AESGCM(dek).decrypt(envelope.data_nonce, envelope.ciphertext, aad))
            result = callback(memoryview(buffer))
            outcome, reason = "completed", "completed"
            return result
        except Exception:
            outcome, reason = "callback_failed", "ciphertext_invalid"
            raise
        finally:
            if buffer is not None:
                for index in range(len(buffer)): buffer[index] = 0
            terminal_body = {**attempt_body,
                "receipt_id": f"osr_{digest({'decision': decision.decision_hash, 'stage': 2})[:48]}",
                "stage": "terminal", "outcome": outcome, "reason": reason, "sequence": 2}
            await writer.append_terminal(with_hash(SecretAccessReceipt, "receipt_hash", **terminal_body))

    def disable(self, descriptor_id: str) -> None:
        descriptor = self.__descriptors[descriptor_id]
        self.__descriptors[descriptor_id] = descriptor.model_copy(update={"state": "disabled"})

    def lose_kek(self, version: int) -> None:
        self.__keks.pop(version, None)
