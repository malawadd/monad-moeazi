// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MonadTestnetRegistry} from "./MonadTestnetRegistry.sol";
import {SafeToken} from "./SafeToken.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";

/// @notice Owner wallet adapter for exact Monad v4 pool keys with no hooks.
/// @dev Transactions must be built from a fresh quote and bind the expected PoolId.
contract UniswapV4DynamicNoHookAdapter is IUnlockCallback {
    using SafeToken for address;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManager public immutable manager = IPoolManager(MonadTestnetRegistry.V4_POOL_MANAGER);
    uint256 private constant MAX_AMOUNT_IN = type(uint128).max / 2;
    uint256 private entered;

    error WrongChain();
    error InvalidPool();
    error InvalidSwap();
    error PoolUnavailable();
    error SlippageExceeded();
    error UnauthorizedCallback();
    error Reentrant();

    constructor() {
        if (block.chainid != MonadTestnetRegistry.CHAIN_ID) revert WrongChain();
    }

    function quoteExactInput(bytes32 expectedPoolId, PoolKey calldata key, address tokenIn, address tokenOut,
        uint256 amountIn) external returns (uint256 amountOut, bool available)
    {
        PoolKey memory poolKey_ = key;
        return _quote(expectedPoolId, poolKey_, tokenIn, tokenOut, amountIn);
    }

    function swap(bytes32 expectedPoolId, PoolKey calldata key, address tokenIn, address tokenOut,
        uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut)
    {
        if (entered != 0) revert Reentrant();
        entered = 1;
        PoolKey memory poolKey_ = key;
        _validatePool(expectedPoolId, poolKey_, tokenIn, tokenOut);
        if (amountIn == 0 || amountIn > MAX_AMOUNT_IN || minAmountOut == 0) revert InvalidSwap();
        (uint256 quoted, bool available) = _quote(expectedPoolId, poolKey_, tokenIn, tokenOut, amountIn);
        if (!available) revert PoolUnavailable();
        if (quoted < minAmountOut) revert SlippageExceeded();

        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);
        bytes memory result = manager.unlock(abi.encode(expectedPoolId, poolKey_, tokenIn, tokenOut, amountIn, minAmountOut));
        amountOut = abi.decode(result, (uint256));
        if (amountOut < minAmountOut) revert SlippageExceeded();
        tokenOut.safeTransfer(msg.sender, amountOut);
        entered = 0;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager) || entered != 1) revert UnauthorizedCallback();
        (bytes32 expectedPoolId, PoolKey memory key, address tokenIn, address tokenOut,
            uint256 amountIn, uint256 minAmountOut) = abi.decode(data,
                (bytes32, PoolKey, address, address, uint256, uint256));
        _validatePool(expectedPoolId, key, tokenIn, tokenOut);
        bool zeroForOne = tokenIn == Currency.unwrap(key.currency0);
        BalanceDelta delta = manager.swap(key, SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(amountIn),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        }), bytes(""));
        int128 inputDelta = zeroForOne ? delta.amount0() : delta.amount1();
        int128 outputDelta = zeroForOne ? delta.amount1() : delta.amount0();
        if (inputDelta >= 0 || outputDelta <= 0 || uint256(-int256(inputDelta)) != amountIn) revert InvalidSwap();
        uint256 amountOut = uint256(uint128(outputDelta));
        if (amountOut < minAmountOut) revert SlippageExceeded();
        Currency inputCurrency = Currency.wrap(tokenIn);
        manager.sync(inputCurrency);
        tokenIn.safeTransfer(address(manager), amountIn);
        manager.settle();
        manager.take(Currency.wrap(tokenOut), address(this), amountOut);
        return abi.encode(amountOut);
    }

    function _quote(bytes32 expectedPoolId, PoolKey memory key, address tokenIn, address tokenOut,
        uint256 amountIn) private returns (uint256 amountOut, bool available)
    {
        if (amountIn == 0 || amountIn > MAX_AMOUNT_IN) return (0, false);
        try this.validatePool(expectedPoolId, key, tokenIn, tokenOut) {} catch { return (0, false); }
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(key.toId());
        if (sqrtPriceX96 == 0) return (0, false);
        try IV4Quoter(MonadTestnetRegistry.V4_QUOTER).quoteExactInputSingle(
            IV4Quoter.QuoteExactSingleParams({
                poolKey: key,
                zeroForOne: tokenIn == Currency.unwrap(key.currency0),
                exactAmount: uint128(amountIn),
                hookData: bytes("")
            })
        ) returns (uint256 quoted, uint256) {
            return (quoted, quoted != 0);
        } catch { return (0, false); }
    }

    function validatePool(bytes32 expectedPoolId, PoolKey calldata key, address tokenIn, address tokenOut) external pure {
        _validatePool(expectedPoolId, key, tokenIn, tokenOut);
    }

    function _validatePool(bytes32 expectedPoolId, PoolKey memory key, address tokenIn, address tokenOut) private pure {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        if (address(key.hooks) != address(0) || currency0 == address(0) || currency0 >= currency1 || key.tickSpacing <= 0
            || PoolId.unwrap(key.toId()) != expectedPoolId || tokenIn == tokenOut
            || !((tokenIn == currency0 && tokenOut == currency1) || (tokenIn == currency1 && tokenOut == currency0))) {
            revert InvalidPool();
        }
    }
}
