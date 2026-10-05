// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Addresses from Circle's Monad testnet page, Monad's published token list,
/// and the Monad community Uniswap v4 example's shared infrastructure registry.
library MonadTestnetRegistry {
    uint256 internal constant CHAIN_ID = 10143;

    address internal constant USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;
    address internal constant WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;

    address internal constant V4_POOL_MANAGER = 0x451D64ab3b650040d2aE1886602b97ed6eDc643d;
    address internal constant V4_POSITION_MANAGER = 0x3Bb14E3D0Cd50aBe3EdACa06d06c29C78676C31A;
    address internal constant V4_STATE_VIEW = 0xB639209539c61BaF67AC04876315786F8D0b153c;
    address internal constant V4_QUOTER = 0x869834d127b230283fe63E0d0A9bEB67216a94C7;
    address internal constant V4_UNIVERSAL_ROUTER = 0x1b7bFCd2870329B987191910D85c22C7287f3c22;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Candidate no-hook USDC/WMON pool shape using the fee and tick spacing shown
    // in Monad's community lifecycle guide. Initialization and liquidity are checked
    // at runtime; these values do not imply that this pool currently exists.
    uint24 internal constant V4_POOL_FEE = 3000;
    int24 internal constant V4_TICK_SPACING = 60;
}

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address holder, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address holder, address recipient, uint256 amount) external returns (bool);
}

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

interface ISwapVenueAdapter {
    function quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn, bytes calldata venueData)
        external returns (uint256 amountOut, bool available);

    /// @dev Pulls input from msg.sender and sends output to msg.sender.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes calldata venueData)
        external returns (uint256 amountOut);
}
