// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PerpClearinghouseOrders} from "./PerpClearinghouseOrders.sol";

abstract contract PerpClearinghouseSettlement is PerpClearinghouseOrders {
    constructor(address administrator_, address usdc_, address[3] memory tokens_, address[3] memory pools_)
        PerpClearinghouseOrders(administrator_, usdc_, tokens_, pools_) {}

    function closePosition(bytes32 orderId, uint8 reason, uint256 expectedPriceWad, uint64 validUntil)
        external onlyVault nonReentrant
    {
        PositionData storage p = position[msg.sender];
        if (!p.open || orderId == bytes32(0) || reason > 5) revert InvalidPosition();
        if ((reason == 0 && expectedPriceWad == 0)
            || ((reason == 4 || reason == 5) && expectedPriceWad != 0)) revert StalePrice();
        _settlePortion(msg.sender, orderId, p.sizeWad, reason, expectedPriceWad, validUntil);
    }

    function executeTrigger(bytes32 orderId, uint256 expectedPriceWad, uint64 validUntil)
        external onlyVault nonReentrant
    {
        PositionData storage p = position[msg.sender];
        if (!p.open || orderId == bytes32(0)) revert InvalidPosition();
        uint256 mark = _checkExpectedPrice(p.marketIndex, expectedPriceWad, validUntil);
        bool takeProfit = p.takeProfitWad != 0
            && (p.isLong ? mark >= p.takeProfitWad : mark <= p.takeProfitWad);
        bool stopLoss = p.stopLossWad != 0
            && (p.isLong ? mark <= p.stopLossWad : mark >= p.stopLossWad);
        if (!takeProfit && !stopLoss) revert TriggerNotReached();
        _settlePortion(msg.sender, orderId, p.sizeWad, takeProfit ? 1 : 2, expectedPriceWad, validUntil);
    }

    function liquidate(bytes32 orderId) external onlyVault nonReentrant {
        PositionData storage p = position[msg.sender];
        if (!p.open || orderId == bytes32(0)) revert InvalidPosition();
        _accrue(p, msg.sender, orderId);
        uint256 mark = _price(p.marketIndex);
        uint256 notional = p.sizeWad * mark / 1e30;
        uint256 maintenance = notional * MAINTENANCE_BPS / BPS;
        int256 equity = _equity(p, mark);
        if (equity > int256(maintenance)) revert NotLiquidatable();
        emit Liquidated(msg.sender, orderId, mark, equity, maintenance);
        _settlePortion(msg.sender, orderId, p.sizeWad, 3, 0, 0);
    }
}
