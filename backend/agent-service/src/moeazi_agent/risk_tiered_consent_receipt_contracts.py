from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import Field
from .risk_tiered_consent_scope_contracts import Frozen,Hash
class SignerVerificationObservation(Frozen):
    provider:Literal["particle","magic"]; method:Literal["synthetic_owner_proof"]
    expected_signer_fingerprint:str; observed_signer_fingerprint:str; packet_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
    challenge_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); verified_at:datetime; status:Literal["accepted","rejected"]
    synthetic:Literal[True]=True; raw_signature:None=None
class ApprovalConsentReceipt(Frozen):
    packet_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); challenge_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); outcome:Literal["accepted","declined","expired","rejected"]
    consumed_at:datetime; receipt_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); fixture_only:Literal[True]=True; accepted_for_product:Literal[False]=False; non_authorizing:Literal[True]=True
