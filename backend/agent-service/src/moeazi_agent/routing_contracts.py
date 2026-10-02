from datetime import UTC, datetime, timedelta
from enum import StrEnum

from pydantic import BaseModel, Field, field_validator, model_validator


class VenueId(StrEnum):
    HYPERLIQUID = "hyperliquid"
    LIGHTER = "lighter"
    ORDERLY = "orderly"
    GMX = "gmx"
    OSTIUM = "ostium"


class RouteSide(StrEnum):
    LONG = "long"
    SHORT = "short"


class VenueLevel(BaseModel):
    price: float = Field(gt=0)
    size: float = Field(gt=0)


class MarketListing(BaseModel):
    market_id: str
    label: str
    base_symbol: str
    quote_symbol: str = "USDC"
    category: str = "crypto"
    max_leverage: float = Field(default=1, ge=1)
    price_precision: int = Field(default=2, ge=0, le=12)
    mark_price: float | None = Field(default=None, gt=0)
    oracle_price: float | None = Field(default=None, gt=0)
    prev_day_price: float | None = Field(default=None, gt=0)
    day_change_pct: float | None = None
    open_interest_usd: float | None = Field(default=None, ge=0)
    volume_24h_usd: float | None = Field(default=None, ge=0)
    funding_rate_hourly: float | None = None
    venues: list[VenueId]


class PublicVenueSnapshot(BaseModel):
    venue: VenueId
    market_id: str
    mid_price: float = Field(gt=0)
    bid_price: float = Field(gt=0)
    ask_price: float = Field(gt=0)
    bids: list[VenueLevel] = Field(default_factory=list)
    asks: list[VenueLevel] = Field(default_factory=list)
    max_leverage: float = Field(default=1, ge=1)
    min_notional_usd: float = Field(default=5, ge=0)
    taker_fee_bps: float = Field(default=0, ge=0)
    funding_rate_hourly: float = 0
    open_interest_usd: float = Field(default=0, ge=0)
    volume_24h_usd: float = Field(default=0, ge=0)
    observed_at: datetime
    source: str


class RouteRequest(BaseModel):
    market_id: str
    side: RouteSide
    margin_usd: float = Field(gt=0)
    leverage: float = Field(gt=0)
    hold_time_hours: float | None = Field(default=None, ge=0, le=8760)
    slippage_cap_bps: float = Field(default=75, ge=0, le=5000)
    ready_venues: list[VenueId] = Field(default_factory=list)
    allowed_venues: list[VenueId] = Field(default_factory=lambda: list(VenueId))
    override_venue: VenueId | None = None


class CostBreakdown(BaseModel):
    entry_fee_usd: float = 0
    exit_fee_usd: float = 0
    entry_slippage_usd: float = 0
    exit_slippage_usd: float = 0
    funding_usd: float = 0
    setup_cost_usd: float = 0
    total_cost_usd: float = 0


class VenueRouteQuote(BaseModel):
    venue: VenueId
    venue_label: str
    kind: str
    market_eligible: bool
    account_ready: bool
    executable: bool
    reason: str | None = None
    setup_requirement: str | None = None
    mid_price: float | None = None
    estimated_entry_price: float | None = None
    estimated_exit_price: float | None = None
    available_depth_usd: float | None = None
    notional_usd: float
    max_leverage: float
    fee_rate_bps: float = 0
    freshness_ms: int | None = None
    source: str = "none"
    costs: CostBreakdown = Field(default_factory=CostBreakdown)


class RoutePreview(BaseModel):
    request: RouteRequest
    market: MarketListing
    best_market_venue: VenueId | None
    best_executable_venue: VenueId | None
    selected_venue: VenueId | None
    override_applied: bool = False
    quotes: list[VenueRouteQuote]
    warnings: list[str] = Field(default_factory=list)
    created_at: datetime
    expires_at: datetime

    @classmethod
    def create(cls, **values):
        now = datetime.now(UTC)
        return cls(created_at=now, expires_at=now + timedelta(seconds=20), **values)


class SwapQuoteRequest(BaseModel):
    token_in: str
    token_out: str
    amount: str
    type: str = "EXACT_INPUT"
    token_in_chain_id: str
    token_out_chain_id: str
    swapper: str
    slippage_tolerance: float | None = Field(default=None, ge=0, le=100)

    @field_validator("token_in", "token_out", "swapper")
    @classmethod
    def valid_address(cls, value: str):
        if len(value) != 42 or not value.startswith("0x"):
            raise ValueError("Expected an EVM address")
        int(value[2:], 16)
        return value.lower()

    @field_validator("amount")
    @classmethod
    def integer_amount(cls, value: str):
        if not value.isdigit() or int(value) <= 0:
            raise ValueError("Amount must be a positive integer in base units")
        return value

    @field_validator("token_in_chain_id", "token_out_chain_id")
    @classmethod
    def arbitrum_only(cls, value: str):
        if value != "42161":
            raise ValueError("Strategy swaps must use Arbitrum mainnet (42161)")
        return value

    @model_validator(mode="after")
    def reject_same_token(self):
        if self.token_in.lower() == self.token_out.lower() and self.token_in_chain_id == self.token_out_chain_id:
            raise ValueError("Choose two different assets")
        return self


class SwapApprovalRequest(BaseModel):
    wallet_address: str
    token: str
    amount: str
    chain_id: int = 42161

    @model_validator(mode="after")
    def validate_request(self):
        if self.chain_id != 42161:
            raise ValueError("Strategy approvals must use Arbitrum mainnet (42161)")
        for value in (self.wallet_address, self.token):
            if len(value) != 42 or not value.startswith("0x"):
                raise ValueError("Expected an EVM address")
            int(value[2:], 16)
        if not self.amount.isdigit() or int(self.amount) <= 0:
            raise ValueError("Amount must be a positive integer in base units")
        return self


class SwapPrepareRequest(BaseModel):
    quote_response: dict
    expected_sender: str
    quoted_at: int
    signature: str | None = None

    @field_validator("expected_sender")
    @classmethod
    def valid_sender(cls, value: str):
        if len(value) != 42 or not value.startswith("0x"):
            raise ValueError("Expected an EVM address")
        int(value[2:], 16)
        return value.lower()
