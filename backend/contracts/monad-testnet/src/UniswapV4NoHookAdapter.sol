// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ISwapVenueAdapter, MonadTestnetRegistry} from "./MonadTestnetRegistry.sol";
import {SafeToken} from "./SafeToken.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";

/// @notice Manual-wallet and vault adapter for the fixed Monad community v4 manager.
/// @dev The candidate no-hook pool may be absent; quoteExactInput then returns unavailable.
contract UniswapV4NoHookAdapter is ISwapVenueAdapter, IUnlockCallback {
    using SafeToken for address;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManager public immutable manager = IPoolManager(MonadTestnetRegistry.V4_POOL_MANAGER);
    address public constant usdc = MonadTestnetRegistry.USDC;
    address public constant wmon = MonadTestnetRegistry.WMON;
    uint256 private constant MAX_AMOUNT_IN = type(uint128).max / 2;
    uint256 private _entered;

    error WrongChain();
    error InvalidPair();
    error InvalidSwap();
    error PoolUnavailable();
    error SlippageExceeded();
    error TransferFailed();
    error UnauthorizedCallback();
    error Reentrant();

    constructor() {
        if (block.chainid != MonadTestnetRegistry.CHAIN_ID) revert WrongChain();
    }

    function poolKey() public pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(usdc),
            currency1: Currency.wrap(wmon),
            fee: MonadTestnetRegistry.V4_POOL_FEE,
            tickSpacing: MonadTestnetRegistry.V4_TICK_SPACING,
            hooks: IHooks(address(0))
        });
    }

    function quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn, bytes calldata venueData)
        external returns (uint256 amountOut, bool available)
    {
        return _quote(tokenIn, tokenOut, amountIn, venueData);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut,
        bytes calldata venueData) external returns (uint256 amountOut)
    {
        if (_entered != 0) revert Reentrant();
        _entered = 1;
        if (amountIn == 0 || amountIn > MAX_AMOUNT_IN || minAmountOut == 0) {
            revert InvalidSwap();
        }
        (uint256 quoted, bool available) = _quote(tokenIn, tokenOut, amountIn, venueData);
        if (!available) revert PoolUnavailable();
        if (quoted < minAmountOut) revert SlippageExceeded();
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);
        bytes memory result = manager.unlock(abi.encode(tokenIn, tokenOut, amountIn, minAmountOut));
        amountOut = abi.decode(result, (uint256));
        if (amountOut < minAmountOut) revert SlippageExceeded();
        tokenOut.safeTransfer(msg.sender, amountOut);
        _entered = 0;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager) || _entered != 1) revert UnauthorizedCallback();
        (address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) =
            abi.decode(data, (address, address, uint256, uint256));
        bool zeroForOne = tokenIn == usdc;
        BalanceDelta delta = manager.swap(poolKey(), SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(amountIn),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        }), bytes(""));
        int128 inputDelta = zeroForOne ? delta.amount0() : delta.amount1();
        int128 outputDelta = zeroForOne ? delta.amount1() : delta.amount0();
        if (inputDelta >= 0 || outputDelta <= 0
            || uint256(-int256(inputDelta)) != amountIn) revert InvalidSwap();
        uint256 amountOut = uint256(uint128(outputDelta));
        if (amountOut < minAmountOut) revert SlippageExceeded();
        manager.sync(Currency.wrap(tokenIn));
        tokenIn.safeTransfer(address(manager), amountIn);
        manager.settle();
        manager.take(Currency.wrap(tokenOut), address(this), amountOut);
        return abi.encode(amountOut);
    }

    function _quote(address tokenIn, address tokenOut, uint256 amountIn, bytes calldata venueData)
        private returns (uint256 amountOut, bool available)
    {
        if (venueData.length != 0 || amountIn == 0 || amountIn > MAX_AMOUNT_IN
            || !((tokenIn == usdc && tokenOut == wmon) || (tokenIn == wmon && tokenOut == usdc))) {
            return (0, false);
        }
        PoolKey memory key = poolKey();
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(key.toId());
        if (sqrtPriceX96 == 0) return (0, false);
        try IV4Quoter(MonadTestnetRegistry.V4_QUOTER).quoteExactInputSingle(
            IV4Quoter.QuoteExactSingleParams({
                poolKey: key,
                zeroForOne: tokenIn == usdc,
                exactAmount: uint128(amountIn),
                hookData: bytes("")
            })
        ) returns (uint256 quoted, uint256) {
            return (quoted, quoted != 0);
        } catch {
            return (0, false);
        }
    }
}
