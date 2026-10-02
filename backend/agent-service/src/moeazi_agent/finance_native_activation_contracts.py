"""Strict identity and owner-approved grant contracts for native finance activation."""
from __future__ import annotations

import re
import json

from pydantic import ConfigDict, Field, StrictInt, field_validator

from .finance_contracts import StrictFinanceModel
from .finance_observation_contracts import ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID
from .observation_contracts import InstrumentVersion


_HEX32 = re.compile(r"^(?:0x)?[0-9a-fA-F]{64}$")
_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
_POOL_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
_UINT = re.compile(r"^(?:0|[1-9][0-9]*)$")


class ActivationRequest(StrictFinanceModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)
    assignment_id: str = Field(alias="assignmentId", min_length=1, max_length=160)
    execution_grant_id: str = Field(alias="executionGrantId", min_length=8, max_length=128,
                                    pattern=r"^[A-Za-z0-9_-]+$")


class ActivationContext(StrictFinanceModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)
    strategy_account_id: str = Field(alias="strategyAccountId", min_length=1, max_length=256)
    customer_subject: str = Field(alias="customerSubject", min_length=1, max_length=512)
    assignment_id: str = Field(alias="assignmentId", min_length=1, max_length=160)
    program_version_id: str = Field(alias="programVersionId", min_length=1, max_length=256)
    content_hash: str = Field(alias="contentHash", min_length=64, max_length=64)
    owner_address: str = Field(alias="ownerAddress", min_length=42, max_length=42)
    venue: str
    venue_account_id: str = Field(alias="venueAccountId", min_length=1, max_length=256)
    source_account_id: str = Field(alias="sourceAccountId", min_length=1, max_length=256)
    policy_hash: str = Field(alias="policyHash", min_length=64, max_length=64)
    policy_json: str | dict = Field(alias="policyJson")
    limits_json: str | dict = Field(alias="limitsJson")
    authority_expires_at: StrictInt = Field(alias="authorityExpiresAt", gt=0)
    execution_grant_id: str = Field(alias="executionGrantId", min_length=8, max_length=128)
    financial_authority: str = Field(alias="financialAuthority")

    @field_validator("content_hash", "policy_hash")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        if not re.fullmatch(r"[0-9a-fA-F]{64}", value):
            raise ValueError("context hash must be 32-byte hex")
        return value.lower()


def normal_address(value: object) -> str:
    if not isinstance(value, str) or not _ADDRESS.fullmatch(value):
        raise ValueError("wallet address is malformed")
    return value.lower()


def exact_grant_limits(context: ActivationContext) -> dict[str, str]:
    """Independently bind signed call bounds to the account's current venue permission."""
    raw = context.limits_json
    try:
        limits = json.loads(raw) if isinstance(raw, str) else raw
    except (ValueError, TypeError) as exc:
        raise ValueError("venue permission limits are malformed") from exc
    if not isinstance(limits, dict) or type(limits.get("schemaVersion")) is not int \
            or limits["schemaVersion"] != 1 \
            or limits.get("strategyAccountId") != context.strategy_account_id \
            or limits.get("assignmentId") != context.assignment_id \
            or limits.get("programVersionId") != context.program_version_id \
            or limits.get("contentHash") != context.content_hash \
            or limits.get("policyHash") != context.policy_hash \
            or limits.get("venueAccountId") != context.venue_account_id \
            or str(limits.get("ownerAddress", "")).lower() != context.owner_address:
        raise ValueError("venue permission limits differ from the managed account")
    fields = ("maxUsdcUnits", "maxWethUnits", "minWethOutUnits", "minUsdcOutUnits")
    if any(not isinstance(limits.get(field), str) or not _UINT.fullmatch(limits[field])
           or len(limits[field]) > 78 or not 0 < int(limits[field]) < 2 ** 256
           for field in fields):
        raise ValueError("venue permission amount bounds are invalid")
    return {field: limits[field] for field in fields}


def validate_grant(raw: dict, *, scope: str, grant_id: str, owner: str,
                   context: ActivationContext) -> tuple[str, int]:
    limits = exact_grant_limits(context)
    grant, operation = raw.get("grant"), raw.get("operation")
    if not isinstance(grant, dict) or operation is not None or raw.get("consumed") is not False:
        raise ValueError("scoped grant must exist and remain unused")
    review = grant.get("review")
    if not isinstance(review, dict):
        raise ValueError("scoped grant review is unavailable")
    if grant.get("grantId") != grant_id or grant.get("scope") != scope \
            or grant.get("state") != "active" \
            or grant.get("strategyAccountId") != context.strategy_account_id \
            or grant.get("assignmentId") != context.assignment_id:
        raise ValueError("active scoped grant identity differs from managed program context")
    if normal_address(grant.get("owner")) != owner or normal_address(review.get("recipient")) != owner:
        raise ValueError("scoped grant owner differs from the exact managed account")
    frozen_hash = str(grant.get("frozenPolicyHash", ""))
    if frozen_hash.lower().removeprefix("0x") != context.policy_hash:
        raise ValueError("scoped grant is not frozen to the managed program policy")
    policy_hash = grant.get("policyHash")
    if not isinstance(policy_hash, str) or not _HEX32.fullmatch(policy_hash):
        raise ValueError("scoped grant policy hash is malformed")
    expiry = grant.get("expiresAt")
    if type(expiry) is not int or expiry <= 0:
        raise ValueError("scoped grant expiry must be Unix seconds")
    direction = ("0xaf88d065e77c8cc2239327c5edb3a432268e5831",
                 "0x82af49447d8a07e3bd95bd0d56f35241523fbab1") if scope == "buy" else (
                 "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
                 "0xaf88d065e77c8cc2239327c5edb3a432268e5831")
    if type(review.get("chainId")) is not int or review["chainId"] != 42161 \
            or str(review.get("router", "")).lower() != "0xe592427a0aece92de3edee1f18e0157c05861564" \
            or type(review.get("feeTier")) is not int or review["feeTier"] != 3000 \
            or tuple(str(review.get(key, "")).lower() for key in ("tokenIn", "tokenOut")) != direction:
        raise ValueError("scoped grant does not cover the exact Arbitrum V3 pair route")
    for key in ("maximumInputUnits", "minimumOutputUnits"):
        value = review.get(key)
        if not isinstance(value, str) or len(value) > 78 or not _UINT.fullmatch(value) \
                or int(value) <= 0 or int(value) >= 2 ** 256:
            raise ValueError("scoped grant amount bounds are invalid")
    maximum = limits["maxUsdcUnits" if scope == "buy" else "maxWethUnits"]
    minimum = limits["minWethOutUnits" if scope == "buy" else "minUsdcOutUnits"]
    if int(review["maximumInputUnits"]) > int(maximum) \
            or int(review["minimumOutputUnits"]) < int(minimum):
        raise ValueError("scoped grant exceeds the exact venue permission bounds")
    if type(review.get("maxCalls")) is not int or review["maxCalls"] != 1 \
            or review.get("callValueWei") != "0" \
            or type(review.get("earliestDeadline")) is not int \
            or type(review.get("latestDeadline")) is not int \
            or review["earliestDeadline"] <= 0 or review["earliestDeadline"] > expiry \
            or review["latestDeadline"] != expiry:
        raise ValueError("scoped grant call and expiry bounds are invalid")
    session_address = grant.get("sessionAddress")
    if not isinstance(session_address, str) or not _ADDRESS.fullmatch(session_address):
        raise ValueError("scoped grant session identity is malformed")
    return policy_hash.lower().removeprefix("0x"), expiry


def exact_pair_policy(policy, raw_manifest: object, registry_hash: object) -> bool:
    try:
        instrument = InstrumentVersion.model_validate(raw_manifest)
    except (ValueError, TypeError):
        return False
    return policy.approved_live and policy.instrument_version_id == instrument.instrument_version_id \
        and instrument.registry_hash == registry_hash and instrument.venue_id == "uniswap" \
        and _POOL_ADDRESS.fullmatch(instrument.native_instrument_id) is not None \
        and instrument.product_kind == "spot" \
        and instrument.price_rule == "uniswap_v3_quoter_v2_exact_input_v1" \
        and instrument.base_asset_unit_id == ARBITRUM_WETH_UNIT_ID \
        and instrument.quote_asset_unit_id == ARBITRUM_USDC_UNIT_ID \
        and instrument.settlement_asset_unit_id == ARBITRUM_USDC_UNIT_ID \
        and (instrument.base_decimals, instrument.quote_decimals,
             instrument.settlement_decimals) == (18, 6, 6) \
        and instrument.contract_multiplier == "1"
