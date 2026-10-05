// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {V4NoHookPoolSeeder} from "../src/V4NoHookPoolSeeder.sol";
import {MonadTestnetRegistry, IERC20Minimal} from "../src/MonadTestnetRegistry.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

interface VmSeedV4 {
    function envAddress(string calldata key) external returns (address);
    function envUint(string calldata key) external returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Initializes only when absent, otherwise adds to the existing canonical no-hook pool.
contract SeedV4NoHookPool {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    VmSeedV4 private constant vm = VmSeedV4(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external {
        address seederAddress = vm.envAddress("MONAD_TESTNET_V4_SEEDER_ADDRESS");
        uint256 usdcAmount = vm.envUint("MONAD_USDC_SEED_AMOUNT");
        uint256 wmonAmount = vm.envUint("MONAD_WMON_SEED_AMOUNT");
        V4NoHookPoolSeeder seeder = V4NoHookPoolSeeder(seederAddress);
        IPoolManager manager = IPoolManager(MonadTestnetRegistry.V4_POOL_MANAGER);
        PoolKey memory key = seeder.poolKey();
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(key.toId());
        uint256 initialPriceWad;
        if (sqrtPriceX96 == 0) {
            // No default price: caller must explicitly choose the initial human-unit ratio.
            initialPriceWad = vm.envUint("MONAD_V4_INITIAL_PRICE_WAD");
        }
        uint160 initialSqrt = sqrtPriceX96 == 0
            ? seeder.sqrtPriceX96ForWmonPerUsdc(initialPriceWad) : 0;

        vm.startBroadcast();
        require(IERC20Minimal(MonadTestnetRegistry.USDC).approve(seederAddress, usdcAmount), "USDC approve failed");
        require(IERC20Minimal(MonadTestnetRegistry.WMON).approve(seederAddress, wmonAmount), "WMON approve failed");
        if (sqrtPriceX96 == 0) {
            seeder.initializeAndSeed(initialSqrt, usdcAmount, wmonAmount);
        } else {
            seeder.seedExisting(usdcAmount, wmonAmount);
        }
        vm.stopBroadcast();
    }
}
