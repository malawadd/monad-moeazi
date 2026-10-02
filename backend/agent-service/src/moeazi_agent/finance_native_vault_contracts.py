"""Strict funded Magic-owned vault identity used by the live finance writer."""
from __future__ import annotations

import re

from pydantic import ConfigDict, Field, field_validator

from .finance_contracts import StrictFinanceModel, native_int


_HASH = re.compile(r"^[0-9a-f]{64}$")
_EVM_HASH = re.compile(r"^0x[0-9a-f]{64}$")
_ADDRESS = re.compile(r"^0x[0-9a-f]{40}$")


class VaultActivationRequest(StrictFinanceModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)

    mandate_id: str = Field(alias="mandateId", min_length=1, max_length=160)


class VaultFinanceContext(StrictFinanceModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)

    financial_authority: str = Field(alias="financialAuthority")
    customer_subject: str = Field(alias="customerSubject")
    strategy_account_id: str = Field(alias="strategyAccountId")
    assignment_id: str = Field(alias="assignmentId")
    program_version_id: str = Field(alias="programVersionId")
    venue_account_id: str = Field(alias="venueAccountId")
    mandate_id: str = Field(alias="mandateId")
    mandate_hash: str = Field(alias="mandateHash")
    owner_address: str = Field(alias="ownerAddress")
    vault_address: str = Field(alias="vaultAddress")
    executor_address: str = Field(alias="executorAddress")
    vault_code_hash: str = Field(alias="vaultCodeHash")
    program_hash: str = Field(alias="programHash")
    policy_hash: str = Field(alias="policyHash")
    capital_units: str = Field(alias="capitalUnits")
    max_buy_units: str = Field(alias="maxBuyUnits")
    expires_at: int = Field(alias="expiresAt")
    source_account_id: str = Field(alias="sourceAccountId")
    venue: str
    policy_json: str | dict = Field(alias="policyJson")

    @field_validator("mandate_hash", "program_hash", "policy_hash")
    @classmethod
    def native_hash(cls, value: str) -> str:
        if not _HASH.fullmatch(value):
            raise ValueError("Funded vault context hash is malformed")
        return value

    @field_validator("vault_code_hash")
    @classmethod
    def code_hash(cls, value: str) -> str:
        if not _EVM_HASH.fullmatch(value):
            raise ValueError("Funded vault bytecode hash is malformed")
        return value

    @field_validator("owner_address", "vault_address", "executor_address")
    @classmethod
    def normalized_address(cls, value: str) -> str:
        if not _ADDRESS.fullmatch(value):
            raise ValueError("Funded vault address is malformed")
        return value

    @field_validator("capital_units", "max_buy_units")
    @classmethod
    def positive_units(cls, value: str) -> str:
        native_int(value, positive=True)
        return value

    def validate_identity(self, *, mandate_id: str, subject: str) -> None:
        if (self.financial_authority != "identity_only" or self.venue != "uniswap"
                or self.customer_subject != subject or self.mandate_id != mandate_id
                or self.owner_address == self.vault_address
                or self.owner_address == self.executor_address
                or self.source_account_id != f"arbitrum:42161:vault:{self.vault_address}"
                or int(self.max_buy_units) > int(self.capital_units)
                or self.expires_at <= 0):
            raise ValueError("Funded Magic vault context differs from its mandate")

    def sidecar_expectation(self) -> dict:
        return {"vaultAddress": self.vault_address, "ownerAddress": self.owner_address,
                "executorAddress": self.executor_address,
                "programHash": self.program_hash, "policyHash": self.policy_hash,
                "capitalUnits": self.capital_units, "maxBuyUnits": self.max_buy_units,
                "expiresAt": self.expires_at, "codeHash": self.vault_code_hash}
