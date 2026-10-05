// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "./TestBase.sol";
import {MonadTestnetRegistry} from "../src/MonadTestnetRegistry.sol";
import {UniswapV4NoHookAdapter} from "../src/UniswapV4NoHookAdapter.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {V4NoHookPoolSeeder} from "../src/V4NoHookPoolSeeder.sol";

/// @notice Read-only fork assertion against the actual Monad pool state; it never seeds or swaps.
contract MonadV4ForkTest is TestBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function testHumanParityUsesSixVsEighteenDecimalScale() public {
        V4NoHookPoolSeeder seeder = new V4NoHookPoolSeeder(address(this));
        assertEq(uint256(seeder.sqrtPriceX96ForWmonPerUsdc(1e18)), uint256(1_000_000) << 96);
    }

    function testNoHookVenueAvailabilityTracksActualPoolAndBothDirections() public {
        // Run with `forge test --fork-url ...`; on a local non-fork test manager.code is empty.
        if (MonadTestnetRegistry.V4_POOL_MANAGER.code.length == 0) return;
        assertTrue(block.chainid == MonadTestnetRegistry.CHAIN_ID);
        UniswapV4NoHookAdapter adapter = new UniswapV4NoHookAdapter();
        PoolKey memory key = adapter.poolKey();
        IPoolManager manager = IPoolManager(MonadTestnetRegistry.V4_POOL_MANAGER);
        (uint160 sqrtPrice,,,) = manager.getSlot0(key.toId());
        uint128 activeLiquidity = manager.getLiquidity(key.toId());
        (uint256 forward, bool forwardAvailable) = adapter.quoteExactInput(
            MonadTestnetRegistry.USDC, MonadTestnetRegistry.WMON, 1e3, bytes("")
        );
        (uint256 reverse, bool reverseAvailable) = adapter.quoteExactInput(
            MonadTestnetRegistry.WMON, MonadTestnetRegistry.USDC, 1e15, bytes("")
        );
        if (sqrtPrice == 0 || activeLiquidity == 0) {
            assertFalse(forwardAvailable);
            assertFalse(reverseAvailable);
            assertEq(forward, 0);
            assertEq(reverse, 0);
        } else {
            assertTrue(forwardAvailable && forward > 0);
            assertTrue(reverseAvailable && reverse > 0);
        }
    }
}
