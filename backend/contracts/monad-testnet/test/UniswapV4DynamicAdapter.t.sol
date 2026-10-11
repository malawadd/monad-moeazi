// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "./TestBase.sol";
import {MonadTestnetRegistry} from "../src/MonadTestnetRegistry.sol";
import {UniswapV4DynamicNoHookAdapter} from "../src/UniswapV4DynamicNoHookAdapter.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

interface IERC20Fork {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract UniswapV4DynamicAdapterTest is TestBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    address private constant FORK_FUNDER = 0xBB66E7bC26d8a81C36a2f900D141a1FA786a98D8;

    function _key(address hooks) private pure returns (PoolKey memory) {
        return PoolKey({currency0: Currency.wrap(MonadTestnetRegistry.USDC),
            currency1: Currency.wrap(MonadTestnetRegistry.WMON), fee: 3000, tickSpacing: 60, hooks: IHooks(hooks)});
    }

    function testRejectsPoolIdMismatchAndHookPool() public {
        UniswapV4DynamicNoHookAdapter adapter = new UniswapV4DynamicNoHookAdapter();
        PoolKey memory noHook = _key(address(0));
        vm.expectRevert(UniswapV4DynamicNoHookAdapter.InvalidPool.selector);
        adapter.swap(bytes32(0), noHook, MonadTestnetRegistry.USDC, MonadTestnetRegistry.WMON, 1, 1);

        PoolKey memory hookKey = _key(address(0x1234));
        PoolId hookId = hookKey.toId();
        vm.expectRevert(UniswapV4DynamicNoHookAdapter.InvalidPool.selector);
        adapter.swap(PoolId.unwrap(hookId), hookKey, MonadTestnetRegistry.USDC,
            MonadTestnetRegistry.WMON, 1, 1);
    }

    function testForkQuotesAndSwapsSeededPoolInBothDirections() public {
        if (MonadTestnetRegistry.V4_POOL_MANAGER.code.length == 0) return;
        assertTrue(block.chainid == MonadTestnetRegistry.CHAIN_ID);
        UniswapV4DynamicNoHookAdapter adapter = new UniswapV4DynamicNoHookAdapter();
        PoolKey memory key = _key(address(0));
        IPoolManager manager = IPoolManager(MonadTestnetRegistry.V4_POOL_MANAGER);
        (uint160 sqrtPrice,,,) = manager.getSlot0(key.toId());
        assertTrue(sqrtPrice != 0 && manager.getLiquidity(key.toId()) > 0);
        _swapUsdcToWmon(adapter, key);
        _swapWmonToUsdc(adapter, key);
    }

    function _swapUsdcToWmon(UniswapV4DynamicNoHookAdapter adapter, PoolKey memory key) private {
        bytes32 poolId = PoolId.unwrap(key.toId()); uint256 usdcIn = 1_000;
        vm.prank(FORK_FUNDER);
        assertTrue(IERC20Fork(MonadTestnetRegistry.USDC).transfer(address(this), usdcIn));
        assertTrue(IERC20Fork(MonadTestnetRegistry.USDC).approve(address(adapter), usdcIn));
        (uint256 wmonQuote, bool wmonAvailable) = adapter.quoteExactInput(poolId, key,
            MonadTestnetRegistry.USDC, MonadTestnetRegistry.WMON, usdcIn);
        assertTrue(wmonAvailable && wmonQuote > 0);
        uint256 wmonBefore = IERC20Fork(MonadTestnetRegistry.WMON).balanceOf(address(this));
        uint256 wmonOut = adapter.swap(poolId, key, MonadTestnetRegistry.USDC,
            MonadTestnetRegistry.WMON, usdcIn, wmonQuote * 9_900 / 10_000);
        assertTrue(wmonOut > 0 && IERC20Fork(MonadTestnetRegistry.WMON).balanceOf(address(this)) == wmonBefore + wmonOut);
    }

    function _swapWmonToUsdc(UniswapV4DynamicNoHookAdapter adapter, PoolKey memory key) private {
        bytes32 poolId = PoolId.unwrap(key.toId()); uint256 wmonIn = 1e15;
        vm.prank(FORK_FUNDER);
        assertTrue(IERC20Fork(MonadTestnetRegistry.WMON).transfer(address(this), wmonIn));
        assertTrue(IERC20Fork(MonadTestnetRegistry.WMON).approve(address(adapter), wmonIn));
        (uint256 usdcQuote, bool usdcAvailable) = adapter.quoteExactInput(poolId, key,
            MonadTestnetRegistry.WMON, MonadTestnetRegistry.USDC, wmonIn);
        assertTrue(usdcAvailable && usdcQuote > 0);
        uint256 usdcBefore = IERC20Fork(MonadTestnetRegistry.USDC).balanceOf(address(this));
        uint256 usdcOut = adapter.swap(poolId, key, MonadTestnetRegistry.WMON,
            MonadTestnetRegistry.USDC, wmonIn, usdcQuote * 9_900 / 10_000);
        assertTrue(usdcOut > 0 && IERC20Fork(MonadTestnetRegistry.USDC).balanceOf(address(this)) == usdcBefore + usdcOut);
    }
}
