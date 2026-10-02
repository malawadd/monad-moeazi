"""Durable fixture nonce allocator contract; never connected to a signer."""
from __future__ import annotations

from .temporal_integrity_contracts import NonceLease, digest


class FixtureNonceAllocator:
    """In-memory test double mirroring the durable unique domain/nonce rule."""
    def __init__(self): self._leases: dict[tuple[str, str], NonceLease] = {}; self._next: dict[tuple[str, str, str], int] = {}

    def reserve(self, domain_id: str, signer: str, account: str, operation: str,
                request_hash: str, idempotency_key: str) -> NonceLease:
        identity = (domain_id, idempotency_key)
        prior = self._leases.get(identity)
        if prior:
            if (prior.request_hash, prior.signer_fingerprint, prior.acted_for_account,
                    prior.operation) != (request_hash, signer, account, operation):
                raise RuntimeError("nonce idempotency binding conflict")
            return prior
        allocation_scope = (domain_id, signer, account)
        nonce = self._next.get(allocation_scope, 0); self._next[allocation_scope] = nonce + 1
        body = {"domain_id": domain_id, "signer_fingerprint": signer, "acted_for_account": account,
            "nonce": nonce, "operation": operation, "request_hash": request_hash,
            "idempotency_key": idempotency_key, "state": "reserved"}
        lease = NonceLease(**body, lease_hash=digest(body)); self._leases[identity] = lease
        return lease

    def transition(self, lease: NonceLease, state: str) -> NonceLease:
        current = self._leases.get((lease.domain_id, lease.idempotency_key), lease)
        if current.lease_hash != lease.lease_hash and lease.state != current.state:
            raise RuntimeError("stale nonce lease transition")
        transitions = {
            "reserved": {"signed", "possibly_submitted", "rejected_unused", "superseded"},
            "signed": {"possibly_submitted", "confirmed", "superseded"},
            "possibly_submitted": {"confirmed", "superseded"},
            "confirmed": set(), "rejected_unused": set(), "superseded": set(),
        }
        if state not in transitions[current.state]:
            raise RuntimeError("invalid nonce lifecycle transition")
        body = current.model_dump(exclude={"lease_hash"}); body["state"] = state
        result = NonceLease(**body, lease_hash=digest(body)); self._leases[(lease.domain_id, lease.idempotency_key)] = result
        return result
