// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library AutonomyTypes {
    struct CircleAuthorization {
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
}

interface ICircleReceiveAuthorization {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

interface IAutonomyPairPool {
    function usdc() external view returns (address);
    function token() external view returns (address);
    function quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn)
        external view returns (uint256 amountOut, bool available);
    function quoteSpotExactInput(address tokenIn, address tokenOut, uint256 amountIn)
        external view returns (uint256 amountOut, bool available);
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external returns (uint256 amountOut);
}
