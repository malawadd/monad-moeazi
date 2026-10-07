// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PerpClearinghouseBase} from "./PerpClearinghouseBase.sol";
import {SafeToken} from "../SafeToken.sol";

abstract contract PerpClearinghouseOrders is PerpClearinghouseBase {
    using SafeToken for address;
    constructor(address administrator_, address usdc_, address[3] memory tokens_, address[3] memory pools_)
        PerpClearinghouseBase(administrator_, usdc_, tokens_, pools_) {}

    function submitEntry(bytes32 orderId, uint8 marketIndex, bool isLong, uint8 leverage,
        uint256 marginUsdc, uint256 limitPriceWad, uint256 expectedPriceWad, uint64 validUntil)
        external onlyVault nonReentrant
    {
        address vault = msg.sender;
        _requireRun(vault);
        if (orderId == bytes32(0) || position[vault].open || pendingOrder[vault].orderId != bytes32(0)
            || marketIndex >= 3 || leverage < 1 || leverage > 10 || marginUsdc == 0) revert InvalidOrder();
        PendingData memory order = PendingData(orderId, marketIndex, isLong, leverage,
            marginUsdc, limitPriceWad, validUntil);
        if (limitPriceWad == 0) {
            uint256 mark = _checkExpectedPrice(marketIndex, expectedPriceWad, validUntil);
            userCollateralTotal += marginUsdc;
            _open(vault, order, mark);
            emit EntrySubmitted(vault, orderId, marketIndex, isLong, leverage, marginUsdc, 0, true);
            return;
        }
        if (expectedPriceWad != 0 || validUntil <= block.timestamp
            || validUntil > vaultExpiresAt[vault]) revert InvalidOrder();
        uint256 mark = _price(marketIndex);
        userCollateralTotal += marginUsdc;
        if (_limitReached(order, mark)) {
            _open(vault, order, mark);
            emit EntrySubmitted(vault, orderId, marketIndex, isLong, leverage, marginUsdc, limitPriceWad, true);
            emit LimitFilled(vault, orderId, mark, position[vault].sizeWad);
        } else {
            pendingOrder[vault] = order;
            emit EntrySubmitted(vault, orderId, marketIndex, isLong, leverage, marginUsdc, limitPriceWad, false);
        }
    }

    function fillEntry(bytes32 orderId) external onlyVault nonReentrant {
        address vault = msg.sender;
        _requireRun(vault);
        PendingData memory order = pendingOrder[vault];
        if (order.orderId == bytes32(0) || order.orderId != orderId || block.timestamp >= order.goodUntil)
            revert InvalidOrder();
        uint256 mark = _price(order.marketIndex);
        if (!_limitReached(order, mark)) revert LimitNotReached();
        delete pendingOrder[vault];
        _open(vault, order, mark);
        emit LimitFilled(vault, orderId, mark, position[vault].sizeWad);
    }

    function amendEntry(bytes32 orderId, uint256 limitPriceWad, uint64 goodUntil) external onlyVault {
        PendingData storage order = pendingOrder[msg.sender];
        if (order.orderId == bytes32(0) || order.orderId != orderId || limitPriceWad == 0
            || goodUntil <= block.timestamp || goodUntil > vaultExpiresAt[msg.sender]) revert InvalidOrder();
        order.limitPriceWad = limitPriceWad; order.goodUntil = goodUntil;
        emit EntrySubmitted(msg.sender, orderId, order.marketIndex, order.isLong,
            order.leverage, order.marginUsdc, limitPriceWad, false);
    }

    function cancelEntry() external onlyVault nonReentrant {
        PendingData memory order = pendingOrder[msg.sender];
        if (order.orderId == bytes32(0)) return;
        delete pendingOrder[msg.sender];
        userCollateralTotal -= order.marginUsdc;
        usdc.safeTransfer(msg.sender, order.marginUsdc);
        emit EntryCancelled(msg.sender, order.orderId, order.marginUsdc);
    }

    function increaseSize(bytes32 orderId, uint256 marginUsdc, uint256 expectedPriceWad, uint64 validUntil)
        external onlyVault nonReentrant
    {
        address vault = msg.sender;
        _requireRun(vault);
        PositionData storage p = position[vault];
        if (!p.open || marginUsdc == 0 || orderId == bytes32(0)) revert InvalidPosition();
        _accrue(p, vault, orderId);
        uint256 mark = _checkExpectedPrice(p.marketIndex, expectedPriceWad, validUntil);
        uint256 addSize = _sizeFor(marginUsdc, p.leverage, mark);
        if (addSize == 0) revert InvalidAmount();
        _commitReserve(marginUsdc);
        uint256 oldSize = p.sizeWad;
        p.entryPriceWad = (p.entryPriceWad * oldSize + mark * addSize) / (oldSize + addSize);
        p.sizeWad = oldSize + addSize;
        p.marginUsdc += marginUsdc; userCollateralTotal += marginUsdc;
        _checkLeverage(p, mark);
        emit PositionChanged(vault, orderId, p.marginUsdc, p.sizeWad, p.entryPriceWad, p.leverage);
    }

    function reduceSize(bytes32 orderId, uint256 closeSizeWad,
        uint256 expectedPriceWad, uint64 validUntil) external onlyVault nonReentrant
    {
        if (orderId == bytes32(0)) revert InvalidOrder();
        _settlePortion(msg.sender, orderId, closeSizeWad, 0, expectedPriceWad, validUntil);
        PositionData storage p = position[msg.sender];
        if (p.open) emit PositionChanged(msg.sender, orderId, p.marginUsdc, p.sizeWad, p.entryPriceWad, p.leverage);
    }

    function addMargin(bytes32 orderId, uint256 amountUsdc,
        uint256 expectedPriceWad, uint64 validUntil) external onlyVault nonReentrant
    {
        address vault = msg.sender;
        _requireRun(vault);
        PositionData storage p = position[vault];
        if (!p.open || amountUsdc == 0 || orderId == bytes32(0)) revert InvalidPosition();
        _accrue(p, vault, orderId);
        uint256 mark = _checkExpectedPrice(p.marketIndex, expectedPriceWad, validUntil);
        _commitReserve(amountUsdc);
        p.marginUsdc += amountUsdc; userCollateralTotal += amountUsdc;
        _checkLeverage(p, mark);
        emit PositionChanged(vault, orderId, p.marginUsdc, p.sizeWad, p.entryPriceWad, p.leverage);
    }

    function removeMargin(bytes32 orderId, uint256 amountUsdc,
        uint256 expectedPriceWad, uint64 validUntil) external onlyVault nonReentrant
    {
        address vault = msg.sender;
        PositionData storage p = position[vault];
        if (!p.open || amountUsdc == 0 || amountUsdc >= p.marginUsdc || orderId == bytes32(0))
            revert InvalidPosition();
        _accrue(p, vault, orderId);
        uint256 mark = _checkExpectedPrice(p.marketIndex, expectedPriceWad, validUntil);
        uint256 notional = p.sizeWad * mark / 1e30;
        uint256 postMargin = p.marginUsdc - amountUsdc;
        if (notional > postMargin * 10 || notional < postMargin) revert InvalidAmount();
        int256 postEquity = _equity(p, mark) - int256(amountUsdc);
        if (postEquity <= int256(notional * MAINTENANCE_BPS / BPS)) revert InvalidAmount();
        uint256 release = amountUsdc * RESERVE_MULTIPLE;
        if (reserveCommitted < release) revert InsufficientReserve();
        reserveCommitted -= release; p.marginUsdc -= amountUsdc; userCollateralTotal -= amountUsdc;
        usdc.safeTransfer(vault, amountUsdc);
        emit PositionChanged(vault, orderId, p.marginUsdc, p.sizeWad, p.entryPriceWad, p.leverage);
    }

    function setTriggers(bytes32 orderId, uint256 takeProfitWad, uint256 stopLossWad) external onlyVault {
        PositionData storage p = position[msg.sender];
        if (!p.open || orderId == bytes32(0)) revert InvalidPosition();
        if (takeProfitWad != 0 && ((p.isLong && takeProfitWad <= p.entryPriceWad)
            || (!p.isLong && takeProfitWad >= p.entryPriceWad))) revert InvalidAmount();
        if (stopLossWad != 0 && ((p.isLong && stopLossWad >= p.entryPriceWad)
            || (!p.isLong && stopLossWad <= p.entryPriceWad))) revert InvalidAmount();
        p.takeProfitWad = takeProfitWad; p.stopLossWad = stopLossWad;
        emit TriggersChanged(msg.sender, orderId, takeProfitWad, stopLossWad);
    }

    function accrueFunding(bytes32 orderId) external onlyVault {
        PositionData storage p = position[msg.sender];
        if (!p.open || orderId == bytes32(0)) revert InvalidPosition();
        _accrue(p, msg.sender, orderId);
    }

    function _open(address vault, PendingData memory order, uint256 mark) internal {
        uint256 size = _sizeFor(order.marginUsdc, order.leverage, mark);
        if (size == 0) revert InvalidAmount();
        _commitReserve(order.marginUsdc);
        position[vault] = PositionData(true, order.isLong, order.marketIndex, order.leverage,
            order.marginUsdc, size, mark, 0, 0, 0, uint64(block.timestamp), uint64(block.timestamp));
        ++openPositionCount;
        emit PositionChanged(vault, order.orderId, order.marginUsdc, size, mark, order.leverage);
    }

    function _limitReached(PendingData memory order, uint256 mark) internal pure returns (bool) {
        return order.isLong ? mark <= order.limitPriceWad : mark >= order.limitPriceWad;
    }

    function _checkLeverage(PositionData storage p, uint256 mark) private view {
        uint256 notional = p.sizeWad * mark / 1e30;
        if (notional > p.marginUsdc * 10 || notional < p.marginUsdc) revert InvalidAmount();
    }
}
