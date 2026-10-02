"""Durable evidence bridge for one finalized Arbitrum Uniswap V3 quote."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import re

from pydantic import ConfigDict, Field, StrictInt, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .finance_contracts import FinanceError, StrictFinanceModel, native_int


USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"
WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"
V3_SWAP_ROUTER = "0xe592427a0aece92de3edee1f18e0157c05861564"
V3_QUOTER_V2 = "0x61ffe014ba17989e743c5f6cb21bf9697530b21e"
QUOTE_RIGHTS = "arbitrum_finalized_rpc:uniswap_v3_quoter_v2"
UNISWAP_V3_PRICE_RULE = "uniswap_v3_quoter_v2_exact_input_v1"
_HEX32 = re.compile(r"^0x[0-9a-fA-F]{64}$")
_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
_UINT256_MAX = 2 ** 256 - 1


class SourceBlock(StrictFinanceModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)

    number: str
    hash: str
    timestamp: str
    finality: str

    @field_validator("number", "timestamp")
    @classmethod
    def positive_native(cls, value: str) -> str:
        native_int(value, positive=True)
        return value

    @field_validator("hash")
    @classmethod
    def block_hash(cls, value: str) -> str:
        if not _HEX32.fullmatch(value):
            raise FinanceError("quote block hash is malformed")
        return value.lower()

    @model_validator(mode="after")
    def final_block(self):
        if self.finality != "finalized":
            raise FinanceError("Uniswap quote block is not finalized")
        if int(self.timestamp) > 253402300799:
            raise FinanceError("quote block timestamp exceeds supported UTC range")
        return self


class UniswapV3Quote(StrictFinanceModel):
    """Exact sidecar response; one quote at one block, with no interval claim."""
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)

    schema_version: str = Field(alias="schemaVersion")
    chain_id: StrictInt = Field(alias="chainId")
    venue: str
    router: str
    quoter: str
    pool: str
    token_in: str = Field(alias="tokenIn")
    token_out: str = Field(alias="tokenOut")
    fee_tier: StrictInt = Field(alias="feeTier")
    amount_in: str = Field(alias="amountIn")
    amount_out: str = Field(alias="amountOut")
    minimum_amount_out: str = Field(alias="minimumAmountOut")
    slippage_bps: StrictInt = Field(alias="slippageBps", ge=0, le=500)
    source_block: SourceBlock = Field(alias="sourceBlock")
    sqrt_price_x96_after: str = Field(alias="sqrtPriceX96After")
    initialized_ticks_crossed: str = Field(alias="initializedTicksCrossed")
    gas_estimate: str = Field(alias="gasEstimate")
    evidence_scope: str = "single_finalized_block_exact_input_quote"
    source_rights_ref: str = QUOTE_RIGHTS

    @field_validator("router", "quoter", "pool", "token_in", "token_out")
    @classmethod
    def normalized_address(cls, value: str) -> str:
        if not _ADDRESS.fullmatch(value):
            raise FinanceError("Uniswap quote contains a malformed address")
        return value.lower()

    @field_validator("amount_in", "amount_out", "minimum_amount_out",
                     "sqrt_price_x96_after", "gas_estimate")
    @classmethod
    def positive_uint(cls, value: str) -> str:
        native_int(value, positive=True)
        if int(value) > _UINT256_MAX:
            raise FinanceError("quote integer exceeds EVM uint256 range")
        return value

    @field_validator("initialized_ticks_crossed")
    @classmethod
    def nonnegative_uint(cls, value: str) -> str:
        native_int(value, nonnegative=True)
        if int(value) >= 2 ** 32:
            raise FinanceError("initialized tick count exceeds EVM uint32 range")
        return value

    @field_validator("sqrt_price_x96_after")
    @classmethod
    def sqrt_price_bound(cls, value: str) -> str:
        if int(value) >= 2 ** 160:
            raise FinanceError("post-quote sqrt price exceeds EVM uint160 range")
        return value

    @model_validator(mode="after")
    def exact_route_and_slippage(self):
        if self.schema_version != "arbitrum-v3-quote-v1" or self.chain_id != 42161 \
                or self.venue != "uniswap" or self.router != V3_SWAP_ROUTER \
                or self.quoter != V3_QUOTER_V2 or self.fee_tier != 3000 \
                or self.pool == "0x" + "0" * 40:
            raise FinanceError("quote is outside the admitted Arbitrum Uniswap V3 route")
        if (self.token_in, self.token_out) not in {(USDC, WETH), (WETH, USDC)}:
            raise FinanceError("quote token direction is outside the managed USDC/WETH pair")
        if self.evidence_scope != "single_finalized_block_exact_input_quote" \
                or self.source_rights_ref != QUOTE_RIGHTS:
            raise FinanceError("quote evidence scope or source rights are not admitted")
        expected_min = int(self.amount_out) * (10_000 - self.slippage_bps) // 10_000
        if int(self.minimum_amount_out) != expected_min:
            raise FinanceError("minimum output does not match the declared slippage")
        return self

    @property
    def event_at(self) -> datetime:
        return datetime.fromtimestamp(int(self.source_block.timestamp), tz=timezone.utc)

    @property
    def quote_per_raw_base_unit(self) -> tuple[int, int]:
        if self.token_in == USDC:
            # A buy spends USDC. Use the slippage floor as the received base
            # amount so the native-unit cost ratio stays conservative.
            return int(self.amount_in), int(self.minimum_amount_out)
        # A sell's minimum proceeds are the bounded quote-side value.
        return int(self.minimum_amount_out), int(self.amount_in)


def quote_evidence_hash(quote: UniswapV3Quote) -> str:
    body = quote.model_dump(mode="json", by_alias=True)
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(("moeazi-uniswap-v3-quote-v1\n" + encoded).encode()).hexdigest()


def validate_sidecar_quote(payload: dict, *, received_at: datetime) -> UniswapV3Quote:
    """Validate a decoded response from the authenticated internal sidecar client."""
    quote = UniswapV3Quote.model_validate(payload)
    if received_at.tzinfo is None or received_at.utcoffset() is None \
            or quote.event_at > received_at.astimezone(timezone.utc):
        raise FinanceError("quote block time is invalid or later than its receipt")
    return quote


async def load_uniswap_quote(conn, quote_hash: str) -> UniswapV3Quote:
    row = (await conn.execute(text("""
        SELECT payload FROM observation_uniswap_v3_quotes WHERE quote_hash=:hash
    """), {"hash": quote_hash})).mappings().first()
    if row is None:
        raise FinanceError("stored native Uniswap quote is missing")
    quote = UniswapV3Quote.model_validate(row["payload"])
    if quote_evidence_hash(quote) != quote_hash:
        raise FinanceError("stored Uniswap quote evidence hash differs")
    return quote


class UniswapQuoteEvidenceRepository:
    """Append-only SQL bridge; callers must pass the internal sidecar response."""

    def __init__(self, engine: AsyncEngine):
        self.engine = engine

    async def store_sidecar_quote(self, payload: dict, *, received_at: datetime) -> str:
        quote = validate_sidecar_quote(payload, received_at=received_at)
        digest = quote_evidence_hash(quote)
        body = json.dumps(quote.model_dump(mode="json", by_alias=True),
                          sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        async with self.engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO observation_uniswap_v3_quotes
                  (quote_hash,chain_id,venue,token_in,token_out,fee_tier,amount_in,
                   amount_out,block_number,block_hash,block_at,source_rights_ref,payload)
                VALUES (:hash,42161,'uniswap',:token_in,:token_out,3000,:amount_in,
                        :amount_out,:block_number,:block_hash,:block_at,:rights,
                        CAST(:payload AS jsonb)) ON CONFLICT DO NOTHING
            """), {"hash": digest, "token_in": quote.token_in,
                   "token_out": quote.token_out, "amount_in": quote.amount_in,
                   "amount_out": quote.amount_out, "block_number": quote.source_block.number,
                   "block_hash": quote.source_block.hash, "block_at": quote.event_at,
                   "rights": quote.source_rights_ref, "payload": body})
            stored = (await conn.execute(text("""
                SELECT payload FROM observation_uniswap_v3_quotes WHERE quote_hash=:hash
            """), {"hash": digest})).mappings().first()
            if not stored or dict(stored["payload"]) != json.loads(body):
                raise FinanceError("Uniswap quote identity conflicts with stored evidence")
        return digest
