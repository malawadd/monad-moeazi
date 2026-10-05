// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MonadTestnetRegistry} from "./MonadTestnetRegistry.sol";
import {SafeToken} from "./SafeToken.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @notice Owner-only initializer and full-range liquidity provider for the fixed
/// USDC/WMON no-hook pool. Both seed assets must be held by and approved to this contract.
contract V4NoHookPoolSeeder is IUnlockCallback {
    using SafeToken for address;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManager public immutable manager = IPoolManager(MonadTestnetRegistry.V4_POOL_MANAGER);
    address public immutable owner;
    address public constant usdc = MonadTestnetRegistry.USDC;
    address public constant wmon = MonadTestnetRegistry.WMON;
    uint128 public totalLiquidity;
    uint256 private _entered;

    error WrongChain();
    error Unauthorized();
    error InvalidPool();
    error InvalidAmount();
    error TransferFailed();
    error UnauthorizedCallback();
    error Reentrant();

    event PoolInitialized(uint160 sqrtPriceX96, int24 tick);
    event LiquiditySeeded(uint128 liquidity, uint256 usdcAmount, uint256 wmonAmount);
    event LiquidityRemoved(uint128 liquidity);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address owner_) {
        if (block.chainid != MonadTestnetRegistry.CHAIN_ID) revert WrongChain();
        if (owner_ == address(0) || usdc >= wmon) revert Unauthorized();
        owner = owner_;
    }

    function poolKey() public pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(usdc), currency1: Currency.wrap(wmon),
            fee: MonadTestnetRegistry.V4_POOL_FEE,
            tickSpacing: MonadTestnetRegistry.V4_TICK_SPACING, hooks: IHooks(address(0))
        });
    }

    /// @notice Convert a human WMON-per-USDC price (18 decimals) to raw-unit Q96.
    /// At parity this returns 1_000_000 * 2**96 because USDC has 6 decimals and WMON 18.
    function sqrtPriceX96ForWmonPerUsdc(uint256 priceWad) external pure returns (uint160) {
        uint256 rawPrice = FullMath.mulDiv(priceWad, 1e12, 1e18);
        if (rawPrice == 0) revert InvalidAmount();
        uint256 root = _sqrt(rawPrice);
        if (root > type(uint160).max >> 96) revert InvalidAmount();
        return uint160(root << 96);
    }

    function initializeAndSeed(uint160 sqrtPriceX96, uint256 usdcAmount, uint256 wmonAmount)
        external onlyOwner
    {
        _enter();
        PoolKey memory key = poolKey();
        (uint160 current,,,) = manager.getSlot0(key.toId());
        if (current != 0 || sqrtPriceX96 == 0) revert InvalidPool();
        int24 tick = manager.initialize(key, sqrtPriceX96);
        emit PoolInitialized(sqrtPriceX96, tick);
        _addLiquidity(usdcAmount, wmonAmount);
        _exit();
    }

    function seedExisting(uint256 usdcAmount, uint256 wmonAmount) external onlyOwner {
        _enter();
        _addLiquidity(usdcAmount, wmonAmount);
        _exit();
    }

    function removeLiquidity(uint128 liquidity) external onlyOwner {
        _enter();
        if (liquidity == 0 || liquidity > totalLiquidity) revert InvalidAmount();
        uint256 beforeUsdc = usdc.balanceOf(address(this));
        uint256 beforeWmon = wmon.balanceOf(address(this));
        manager.unlock(abi.encode(true, liquidity));
        totalLiquidity -= liquidity;
        _refund(usdc, beforeUsdc);
        _refund(wmon, beforeWmon);
        emit LiquidityRemoved(liquidity);
        _exit();
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager) || _entered != 1) revert UnauthorizedCallback();
        (bool remove, uint128 liquidity) = abi.decode(data, (bool, uint128));
        int256 delta = remove ? -int256(uint256(liquidity)) : int256(uint256(liquidity));
        int24 lower = TickMath.minUsableTick(MonadTestnetRegistry.V4_TICK_SPACING);
        int24 upper = TickMath.maxUsableTick(MonadTestnetRegistry.V4_TICK_SPACING);
        (BalanceDelta callerDelta,) = manager.modifyLiquidity(poolKey(), ModifyLiquidityParams({
            tickLower: lower, tickUpper: upper, liquidityDelta: delta, salt: bytes32(0)
        }), bytes(""));
        // PoolManager's callerDelta already combines principalDelta and feesAccrued.
        _settle(usdc, callerDelta.amount0());
        _settle(wmon, callerDelta.amount1());
        return bytes("");
    }

    function _addLiquidity(uint256 usdcAmount, uint256 wmonAmount) private {
        if (usdcAmount == 0 || wmonAmount == 0) revert InvalidAmount();
        PoolKey memory key = poolKey();
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(key.toId());
        if (sqrtPriceX96 == 0) revert InvalidPool();
        uint256 beforeUsdc = usdc.balanceOf(address(this));
        uint256 beforeWmon = wmon.balanceOf(address(this));
        usdc.safeTransferFrom(owner, address(this), usdcAmount);
        wmon.safeTransferFrom(owner, address(this), wmonAmount);
        if (usdc.balanceOf(address(this)) != beforeUsdc + usdcAmount
            || wmon.balanceOf(address(this)) != beforeWmon + wmonAmount) revert TransferFailed();
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(TickMath.minUsableTick(MonadTestnetRegistry.V4_TICK_SPACING)),
            TickMath.getSqrtPriceAtTick(TickMath.maxUsableTick(MonadTestnetRegistry.V4_TICK_SPACING)),
            usdcAmount, wmonAmount
        );
        if (liquidity == 0 || uint256(totalLiquidity) + liquidity > type(uint128).max) revert InvalidAmount();
        manager.unlock(abi.encode(false, liquidity));
        totalLiquidity += liquidity;
        uint256 remainingUsdc = usdc.balanceOf(address(this));
        uint256 remainingWmon = wmon.balanceOf(address(this));
        if (remainingUsdc < beforeUsdc || remainingWmon < beforeWmon
            || remainingUsdc - beforeUsdc > usdcAmount || remainingWmon - beforeWmon > wmonAmount) {
            revert TransferFailed();
        }
        uint256 usedUsdc = usdcAmount - (remainingUsdc - beforeUsdc);
        uint256 usedWmon = wmonAmount - (remainingWmon - beforeWmon);
        _refund(usdc, beforeUsdc);
        _refund(wmon, beforeWmon);
        emit LiquiditySeeded(liquidity, usedUsdc, usedWmon);
    }

    function _settle(address token, int128 delta) private {
        Currency currency = Currency.wrap(token);
        if (delta < 0) {
            uint256 amount = uint256(-int256(delta));
            manager.sync(currency);
            token.safeTransfer(address(manager), amount);
            manager.settle();
        } else if (delta > 0) {
            manager.take(currency, address(this), uint256(uint128(delta)));
        }
    }

    function _refund(address token, uint256 baseline) private {
        uint256 balance = token.balanceOf(address(this));
        if (balance > baseline) token.safeTransfer(owner, balance - baseline);
    }

    function _enter() private {
        if (_entered != 0) revert Reentrant();
        _entered = 1;
    }

    function _exit() private { _entered = 0; }

    function _sqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;
        uint256 y = x;
        z = x / 2 + 1;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
