// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ManagedSpotVault} from "./ManagedSpotVault.sol";

/// @notice One deployment authority creates recoverable vaults for Magic-owned mandates.
/// The deployer pays gas but never becomes the customer owner or receives vault funds.
contract ManagedSpotVaultFactory {
    address public immutable deployer;
    address public immutable usdc;
    address public immutable weth;
    address public immutable router;
    mapping(bytes32 => address) public vaultByMandate;

    event VaultDeployed(bytes32 indexed mandateHash, address indexed vault, address indexed owner);
    error Unauthorized();
    error InvalidMandate();

    constructor(address deployer_, address usdc_, address weth_, address router_) {
        if (deployer_ == address(0) || usdc_ == address(0) || weth_ == address(0)
            || router_ == address(0) || usdc_ == weth_) revert InvalidMandate();
        deployer = deployer_;
        usdc = usdc_;
        weth = weth_;
        router = router_;
    }

    function deploy(bytes32 mandateHash, address owner, address executor,
        bytes32 programVersionHash, bytes32 policyHash, uint256 capitalUnits,
        uint256 maxBuyUnits, uint64 expiresAt) external returns (address vault) {
        if (msg.sender != deployer) revert Unauthorized();
        if (mandateHash == bytes32(0)) revert InvalidMandate();
        vault = vaultByMandate[mandateHash];
        if (vault != address(0)) return vault;
        vault = address(new ManagedSpotVault{salt: mandateHash}(owner, executor,
            usdc, weth, router, programVersionHash, policyHash,
            capitalUnits, maxBuyUnits, expiresAt));
        vaultByMandate[mandateHash] = vault;
        emit VaultDeployed(mandateHash, vault, owner);
    }
}
