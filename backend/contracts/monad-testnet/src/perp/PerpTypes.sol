// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AutonomyTypes} from "../autonomy/AutonomyTypes.sol";

interface IPerpPool {
    function usdc() external view returns (address);
    function token() external view returns (address);
    function spotPriceUsdcPerTokenWad() external view returns (uint256);
}

interface IPerpClearinghouse {
    function registerVault(address vault) external;
    function activateVault(uint64 expiresAt) external;
    function currentPrice(uint8 marketIndex) external view returns (uint256);
    function currentMargin(address vault) external view returns (uint256);
    function submitEntry(bytes32 orderId, uint8 marketIndex, bool isLong, uint8 leverage,
        uint256 marginUsdc, uint256 limitPriceWad, uint256 expectedPriceWad, uint64 validUntil) external;
    function fillEntry(bytes32 orderId) external;
    function amendEntry(bytes32 orderId, uint256 limitPriceWad, uint64 goodUntil) external;
    function cancelEntry() external;
    function increaseSize(bytes32 orderId, uint256 marginUsdc, uint256 expectedPriceWad, uint64 validUntil) external;
    function reduceSize(bytes32 orderId, uint256 closeSizeWad, uint256 expectedPriceWad, uint64 validUntil) external;
    function addMargin(bytes32 orderId, uint256 amountUsdc, uint256 expectedPriceWad, uint64 validUntil) external;
    function removeMargin(bytes32 orderId, uint256 amountUsdc, uint256 expectedPriceWad, uint64 validUntil) external;
    function setTriggers(bytes32 orderId, uint256 takeProfitWad, uint256 stopLossWad) external;
    function accrueFunding(bytes32 orderId) external;
    function closePosition(bytes32 orderId, uint8 reason, uint256 expectedPriceWad, uint64 validUntil) external;
    function executeTrigger(bytes32 orderId, uint256 expectedPriceWad, uint64 validUntil) external;
    function liquidate(bytes32 orderId) external;
    function position(address vault) external view returns (
        bool open, bool isLong, uint8 marketIndex, uint8 leverage, uint256 marginUsdc,
        uint256 sizeWad, uint256 entryPriceWad, int256 fundingAccruedUsdc,
        uint256 takeProfitWad, uint256 stopLossWad, uint64 openedAt, uint64 lastFundingAt
    );
    function pendingOrder(address vault) external view returns (
        bytes32 orderId, uint8 marketIndex, bool isLong, uint8 leverage,
        uint256 marginUsdc, uint256 limitPriceWad, uint64 goodUntil
    );
}

interface IPerpFactoryTerminal {
    function onRunTerminal(address owner) external;
}
