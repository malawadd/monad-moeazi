// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MoeaziRiskGuardHook} from "../src/MoeaziRiskGuardHook.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

contract MockPoolManager {
    function before(
        IHooks hook,
        PoolKey calldata key,
        SwapParams calldata params
    ) external returns (bytes4, BeforeSwapDelta, uint24) {
        return hook.beforeSwap(address(this), key, params, "");
    }

    function invokeAfterSwap(
        IHooks hook,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta
    ) external returns (bytes4, int128) {
        return hook.afterSwap(address(this), key, params, delta, "moeazi");
    }
}

contract MoeaziRiskGuardHookTest {
    using PoolIdLibrary for PoolKey;

    MockPoolManager private manager;
    MoeaziRiskGuardHook private hook;
    PoolKey private key;

    function setUp() public {
        manager = new MockPoolManager();
        key = PoolKey({
            currency0: Currency.wrap(address(0x1000)),
            currency1: Currency.wrap(address(0x2000)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0xC0))
        });
        hook = new MoeaziRiskGuardHook(
            IPoolManager(address(manager)),
            PoolId.unwrap(key.toId()),
            100,
            200
        );
    }

    function testExactInputCurrency0WithinLimitPasses() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -100,
            sqrtPriceLimitX96: 0
        });
        (bytes4 selector,, uint24 fee) = manager.before(hook, key, params);
        require(selector == IHooks.beforeSwap.selector, "selector");
        require(fee == 0, "fee override");
    }

    function testExactOutputCurrency1UsesCurrency1Limit() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: 200,
            sqrtPriceLimitX96: 0
        });
        manager.before(hook, key, params);
    }

    function testExceededLimitFailsClosed() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -101,
            sqrtPriceLimitX96: 0
        });
        (bool ok,) = address(manager).call(
            abi.encodeCall(MockPoolManager.before, (hook, key, params))
        );
        require(!ok, "oversized swap passed");
    }

    function testUnexpectedPoolFailsClosed() public {
        PoolKey memory other = key;
        other.fee = 500;
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1,
            sqrtPriceLimitX96: 0
        });
        (bool ok,) = address(manager).call(
            abi.encodeCall(MockPoolManager.before, (hook, other, params))
        );
        require(!ok, "unexpected pool passed");
    }

    function testDirectCallerCannotInvokeSwapHooks() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1,
            sqrtPriceLimitX96: 0
        });
        (bool ok,) = address(hook).call(
            abi.encodeCall(IHooks.beforeSwap, (address(this), key, params, ""))
        );
        require(!ok, "direct caller passed");
    }

    function testAfterSwapReturnsExpectedSelector() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -10,
            sqrtPriceLimitX96: 0
        });
        (bytes4 selector, int128 delta) = manager.invokeAfterSwap(
            hook,
            key,
            params,
            toBalanceDelta(-10, 9)
        );
        require(selector == IHooks.afterSwap.selector, "selector");
        require(delta == 0, "hook delta");
    }
}
