// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MoeaziTestAmmAdapter} from "../src/MoeaziTestAmmAdapter.sol";
import {IERC20Minimal} from "../src/MonadTestnetRegistry.sol";

interface VmSeedAmm {
    function envAddress(string calldata key) external returns (address);
    function envUint(string calldata key) external returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Owner-controlled initial liquidity seed; the caller must hold and approve both tokens.
contract SeedMoeaziAmm {
    VmSeedAmm private constant vm = VmSeedAmm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external {
        address adapterAddress = vm.envAddress("MONAD_TESTNET_AMM_ADAPTER_ADDRESS");
        uint256 usdcAmount = vm.envUint("MONAD_USDC_SEED_AMOUNT");
        uint256 wmonAmount = vm.envUint("MONAD_WMON_SEED_AMOUNT");
        MoeaziTestAmmAdapter adapter = MoeaziTestAmmAdapter(adapterAddress);
        vm.startBroadcast();
        require(IERC20Minimal(adapter.usdc()).approve(adapterAddress, usdcAmount), "USDC approve failed");
        require(IERC20Minimal(adapter.wmon()).approve(adapterAddress, wmonAmount), "WMON approve failed");
        adapter.addLiquidity(usdcAmount, wmonAmount);
        vm.stopBroadcast();
    }
}
