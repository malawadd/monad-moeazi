// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MonadTestnetRegistry} from "../MonadTestnetRegistry.sol";
import {SafeToken} from "../SafeToken.sol";
import {IPerpPool} from "./PerpTypes.sol";

abstract contract PerpClearinghouseBase {
    using SafeToken for address;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_PAYOUT_MULTIPLE = 5;
    uint256 internal constant RESERVE_MULTIPLE = 4;
    uint256 internal constant MAINTENANCE_BPS = 500;
    uint256 internal constant MAX_FUNDING_BPS_PER_DAY = 500;
    uint256 internal constant MAX_PRICE_DEVIATION_BPS = 100;
    uint64 internal constant MAX_PRICE_VALIDITY = 30 seconds;
    uint64 internal constant MAX_RUN_SECONDS = 120 minutes;

    struct PositionData {
        bool open; bool isLong; uint8 marketIndex; uint8 leverage;
        uint256 marginUsdc; uint256 sizeWad; uint256 entryPriceWad;
        int256 fundingAccruedUsdc; uint256 takeProfitWad; uint256 stopLossWad;
        uint64 openedAt; uint64 lastFundingAt;
    }
    struct PendingData {
        bytes32 orderId; uint8 marketIndex; bool isLong; uint8 leverage;
        uint256 marginUsdc; uint256 limitPriceWad; uint64 goodUntil;
    }
    struct CloseData {
        uint8 marketIndex; bool isLong; uint256 sizeWad; uint256 entryPriceWad;
        uint256 exitPriceWad; uint256 marginUsdc; int256 realizedPnlUsdc;
        int256 fundingUsdc; uint256 returnedUsdc;
    }

    address public immutable administrator;
    address public immutable usdc;
    address public factory;
    address[3] internal _tokens;
    address[3] internal _pools;
    bool public factorySet;
    uint256 public operatorReserve;
    uint256 public reserveCommitted;
    uint256 public userCollateralTotal;
    uint256 public openPositionCount;
    int16 public fundingRateBpsPerDay;
    mapping(address => bool) public registeredVault;
    mapping(address => uint64) public vaultExpiresAt;
    mapping(address => PositionData) public position;
    mapping(address => PendingData) public pendingOrder;
    uint256 private _entered;

    error WrongChain(); error Unauthorized(); error InvalidConfiguration();
    error InvalidAmount(); error InvalidOrder(); error InvalidPosition();
    error InsufficientReserve(); error StaleRun(); error PriceUnavailable();
    error LimitNotReached(); error TriggerNotReached(); error NotLiquidatable();
    error Reentrant(); error TransferFailed(); error StalePrice(); error OpenPositionsExist();

    event FactorySet(address indexed factory);
    event VaultRegistered(address indexed vault);
    event ReserveDeposited(address indexed from, uint256 amount, uint256 reserveBalance);
    event ReserveWithdrawn(address indexed to, uint256 amount, uint256 reserveBalance);
    event FundingRateChanged(int16 rateBpsPerDay);
    event FundingAccrued(address indexed vault, bytes32 indexed orderId, int256 amountUsdc,
        int16 rateBpsPerDay, uint64 elapsedSeconds);
    event EntrySubmitted(address indexed vault, bytes32 indexed orderId, uint8 indexed marketIndex,
        bool isLong, uint8 leverage, uint256 marginUsdc, uint256 limitPriceWad, bool filled);
    event LimitFilled(address indexed vault, bytes32 indexed orderId, uint256 entryPriceWad, uint256 sizeWad);
    event PositionChanged(address indexed vault, bytes32 indexed orderId, uint256 marginUsdc,
        uint256 sizeWad, uint256 entryPriceWad, uint8 leverage);
    event PositionClosed(address indexed vault, bytes32 indexed orderId, uint8 indexed marketIndex,
        bool isLong, uint256 sizeWad, uint256 entryPriceWad, uint256 exitPriceWad,
        int256 realizedPnlUsdc, int256 fundingUsdc, uint256 returnedUsdc, uint8 reason);
    event Liquidated(address indexed vault, bytes32 indexed orderId, uint256 markPriceWad,
        int256 equityUsdc, uint256 maintenanceMarginUsdc);
    event EntryCancelled(address indexed vault, bytes32 indexed orderId, uint256 marginReturned);
    event TriggersChanged(address indexed vault, bytes32 indexed orderId,
        uint256 takeProfitWad, uint256 stopLossWad);

    modifier onlyAdmin() { if (msg.sender != administrator) revert Unauthorized(); _; }
    modifier onlyFactory() { if (msg.sender != factory || !factorySet) revert Unauthorized(); _; }
    modifier onlyVault() { if (!registeredVault[msg.sender]) revert Unauthorized(); _; }
    modifier nonReentrant() {
        if (_entered != 0) revert Reentrant(); _entered = 1; _; _entered = 0;
    }

    constructor(address administrator_, address usdc_, address[3] memory tokens_, address[3] memory pools_) {
        if (block.chainid != MonadTestnetRegistry.CHAIN_ID) revert WrongChain();
        if (administrator_ == address(0) || usdc_ != MonadTestnetRegistry.USDC || usdc_.code.length == 0)
            revert InvalidConfiguration();
        administrator = administrator_; usdc = usdc_;
        for (uint8 i; i < 3; ++i) {
            if (tokens_[i] == address(0) || tokens_[i] == usdc_ || tokens_[i].code.length == 0
                || pools_[i].code.length == 0 || IPerpPool(pools_[i]).usdc() != usdc_
                || IPerpPool(pools_[i]).token() != tokens_[i]) revert InvalidConfiguration();
            for (uint8 j; j < i; ++j) if (tokens_[i] == tokens_[j] || pools_[i] == pools_[j])
                revert InvalidConfiguration();
            _tokens[i] = tokens_[i]; _pools[i] = pools_[i];
        }
    }

    function setFactory(address factory_) external onlyAdmin {
        if (factorySet || factory_.code.length == 0) revert InvalidConfiguration();
        factory = factory_; factorySet = true; emit FactorySet(factory_);
    }

    function registerVault(address vault) external onlyFactory {
        if (vault == address(0) || registeredVault[vault]) revert InvalidConfiguration();
        registeredVault[vault] = true; emit VaultRegistered(vault);
    }

    function activateVault(uint64 expiresAt) external onlyVault {
        if (vaultExpiresAt[msg.sender] != 0 || expiresAt <= block.timestamp
            || expiresAt > block.timestamp + MAX_RUN_SECONDS) revert InvalidConfiguration();
        vaultExpiresAt[msg.sender] = expiresAt;
    }

    function depositReserve(uint256 amount) external onlyAdmin nonReentrant {
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        if (usdc.balanceOf(address(this)) != beforeBalance + amount) revert TransferFailed();
        operatorReserve += amount; emit ReserveDeposited(msg.sender, amount, operatorReserve);
    }

    function withdrawReserve(uint256 amount) external onlyAdmin nonReentrant {
        if (amount == 0 || operatorReserve < reserveCommitted
            || amount > operatorReserve - reserveCommitted) revert InsufficientReserve();
        operatorReserve -= amount; usdc.safeTransfer(administrator, amount);
        emit ReserveWithdrawn(administrator, amount, operatorReserve);
    }

    function setFundingRate(int16 rateBpsPerDay) external onlyAdmin {
        if (openPositionCount != 0) revert OpenPositionsExist();
        if (rateBpsPerDay > int16(uint16(MAX_FUNDING_BPS_PER_DAY))
            || rateBpsPerDay < -int16(uint16(MAX_FUNDING_BPS_PER_DAY))) revert InvalidAmount();
        fundingRateBpsPerDay = rateBpsPerDay; emit FundingRateChanged(rateBpsPerDay);
    }

    function currentPrice(uint8 marketIndex) public view returns (uint256 priceWad) {
        if (marketIndex >= 3) return 0;
        (bool ok, bytes memory data) = _pools[marketIndex].staticcall(
            abi.encodeCall(IPerpPool.spotPriceUsdcPerTokenWad, ())
        );
        if (!ok || data.length < 32) return 0;
        priceWad = abi.decode(data, (uint256));
    }

    function currentMargin(address vault) external view returns (uint256) {
        return position[vault].marginUsdc;
    }

    function _requireRun(address vault) internal view {
        uint64 expiry = vaultExpiresAt[vault];
        if (expiry == 0 || block.timestamp >= expiry) revert StaleRun();
    }

    function _commitReserve(uint256 margin) internal {
        uint256 needed = margin * RESERVE_MULTIPLE;
        if (operatorReserve < reserveCommitted || needed > operatorReserve - reserveCommitted)
            revert InsufficientReserve();
        reserveCommitted += needed;
    }

    function _price(uint8 marketIndex) internal view returns (uint256 p) {
        p = currentPrice(marketIndex); if (p == 0) revert PriceUnavailable();
    }

    function _checkExpectedPrice(uint8 marketIndex, uint256 expectedPriceWad, uint64 validUntil)
        internal view returns (uint256 mark)
    {
        if (expectedPriceWad == 0 || validUntil < block.timestamp
            || validUntil > block.timestamp + MAX_PRICE_VALIDITY) revert StalePrice();
        mark = _price(marketIndex);
        uint256 diff = mark >= expectedPriceWad ? mark - expectedPriceWad : expectedPriceWad - mark;
        if (diff > expectedPriceWad * MAX_PRICE_DEVIATION_BPS / BPS) revert StalePrice();
    }

    function _sizeFor(uint256 margin, uint8 leverage, uint256 priceWad) internal pure returns (uint256) {
        return margin * uint256(leverage) * 1e30 / priceWad;
    }

    function _pnl(PositionData storage p, uint256 size, uint256 exitWad) internal view returns (int256) {
        uint256 diff = exitWad >= p.entryPriceWad ? exitWad - p.entryPriceWad : p.entryPriceWad - exitWad;
        uint256 raw = diff * size / 1e30;
        return ((exitWad >= p.entryPriceWad) == p.isLong) ? int256(raw) : -int256(raw);
    }

    function _equity(PositionData storage p, uint256 mark) internal view returns (int256) {
        return int256(p.marginUsdc) + _pnl(p, p.sizeWad, mark) + p.fundingAccruedUsdc;
    }

    function _accrue(PositionData storage p, address vault, bytes32 orderId) internal {
        if (!p.open || block.timestamp <= p.lastFundingAt) return;
        uint64 maxEnd = uint64(uint256(p.openedAt) + MAX_RUN_SECONDS);
        uint64 end = vaultExpiresAt[vault] < maxEnd ? vaultExpiresAt[vault] : maxEnd;
        uint64 nowBounded = uint64(block.timestamp > end ? end : block.timestamp);
        if (nowBounded <= p.lastFundingAt || fundingRateBpsPerDay == 0) {
            p.lastFundingAt = nowBounded; return;
        }
        uint64 elapsed = nowBounded - p.lastFundingAt;
        uint256 notional = p.marginUsdc * p.leverage;
        int256 amount = int256(notional * uint256(_abs(fundingRateBpsPerDay)) * elapsed / (BPS * 1 days));
        if ((fundingRateBpsPerDay > 0) == p.isLong) amount = -amount;
        p.fundingAccruedUsdc += amount; p.lastFundingAt = nowBounded;
        emit FundingAccrued(vault, orderId, amount, fundingRateBpsPerDay, elapsed);
    }

    function _abs(int16 value) internal pure returns (uint256) {
        return uint256(uint16(value < 0 ? -value : value));
    }

    function _settlePortion(address vault, bytes32 orderId, uint256 closeSize, uint8 reason,
        uint256 expectedPriceWad, uint64 validUntil) internal
    {
        PositionData storage p = position[vault];
        if (!p.open || closeSize == 0 || closeSize > p.sizeWad) revert InvalidPosition();
        _accrue(p, vault, orderId);
        uint256 mark = expectedPriceWad == 0 ? _price(p.marketIndex)
            : _checkExpectedPrice(p.marketIndex, expectedPriceWad, validUntil);
        CloseData memory c = _closeData(p, closeSize, mark);
        _applyClose(vault, p, c);
        _emitClosed(vault, orderId, c, reason);
    }

    function _closeData(PositionData storage p, uint256 closeSize, uint256 mark)
        private view returns (CloseData memory c)
    {
        c.marketIndex = p.marketIndex; c.isLong = p.isLong; c.sizeWad = closeSize;
        c.entryPriceWad = p.entryPriceWad; c.exitPriceWad = mark;
        c.marginUsdc = closeSize == p.sizeWad ? p.marginUsdc : p.marginUsdc * closeSize / p.sizeWad;
        if (c.marginUsdc == 0) revert InvalidAmount();
        c.fundingUsdc = closeSize == p.sizeWad ? p.fundingAccruedUsdc
            : p.fundingAccruedUsdc * int256(closeSize) / int256(p.sizeWad);
        c.realizedPnlUsdc = _pnl(p, closeSize, c.exitPriceWad);
        int256 equity = int256(c.marginUsdc) + c.realizedPnlUsdc + c.fundingUsdc;
        if (equity < 0) equity = 0;
        uint256 ceiling = c.marginUsdc * MAX_PAYOUT_MULTIPLE;
        if (uint256(equity) > ceiling) equity = int256(ceiling);
        c.returnedUsdc = uint256(equity);
    }

    function _applyClose(address vault, PositionData storage p, CloseData memory c) private {
        uint256 commitment = c.marginUsdc * RESERVE_MULTIPLE;
        if (reserveCommitted < commitment) revert InsufficientReserve();
        reserveCommitted -= commitment;
        if (c.returnedUsdc > c.marginUsdc) {
            uint256 extra = c.returnedUsdc - c.marginUsdc;
            if (operatorReserve < extra) revert InsufficientReserve();
            operatorReserve -= extra;
        } else operatorReserve += c.marginUsdc - c.returnedUsdc;
        userCollateralTotal -= c.marginUsdc;
        p.marginUsdc -= c.marginUsdc; p.sizeWad -= c.sizeWad; p.fundingAccruedUsdc -= c.fundingUsdc;
        if (p.sizeWad == 0) { delete position[vault]; --openPositionCount; }
        usdc.safeTransfer(vault, c.returnedUsdc);
    }

    function _emitClosed(address vault, bytes32 orderId, CloseData memory c, uint8 reason) private {
        emit PositionClosed(vault, orderId, c.marketIndex, c.isLong, c.sizeWad,
            c.entryPriceWad, c.exitPriceWad, c.realizedPnlUsdc, c.fundingUsdc, c.returnedUsdc, reason);
    }
}
