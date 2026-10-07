// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20MetadataPerpl, PerplTestnetRegistry} from "../src/perpl/PerplTestnetRegistry.sol";
import {PerplStrategyVaultFactory} from "../src/perpl/PerplStrategyVaultFactory.sol";

interface VmPerplStrategyDeploy {
    function envAddress(string calldata key) external returns (address);
    function envString(string calldata key) external returns (string memory);
    function envBool(string calldata key) external returns (bool);
    function startBroadcast() external;
    function stopBroadcast() external;
    function toString(address value) external pure returns (string memory);
    function toString(bytes32 value) external pure returns (string memory);
    function readFile(string calldata path) external view returns (string memory);
    function writeFile(string calldata path, string calldata contents) external;
}

/// @notice Deploys a default-off Perpl strategy factory and writes an unverified draft receipt manifest.
contract DeployPerplStrategyVaultTestnet {
    VmPerplStrategyDeploy private constant vm =
        VmPerplStrategyDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address factoryAddress) {
        if (block.chainid != PerplTestnetRegistry.CHAIN_ID) revert("Monad Testnet 10143 required");
        _requireGates();
        address administrator = vm.envAddress("MONAD_PERPL_ADMINISTRATOR_ADDRESS");
        address operator = vm.envAddress("MONAD_PERPL_OPERATOR_ADDRESS");
        string memory revision = vm.envString("MONAD_SOURCE_REVISION");
        if (administrator == address(0) || operator == address(0) || bytes(revision).length < 7) {
            revert("administrator, operator and source revision required");
        }
        if (IERC20MetadataPerpl(PerplTestnetRegistry.AUSD).decimals() != PerplTestnetRegistry.AUSD_DECIMALS) {
            revert("Perpl AUSD decimals changed");
        }
        vm.startBroadcast();
        PerplStrategyVaultFactory factory = new PerplStrategyVaultFactory(administrator, operator);
        vm.stopBroadcast();
        factoryAddress = address(factory);
        _writeDraft(factoryAddress, administrator, operator, revision);
    }

    function _requireGates() private {
        if (
            !vm.envBool("MONAD_TESTNET_ACTIONS_ENABLED") || !vm.envBool("MONAD_TESTNET_BROADCAST_ENABLED")
                || !vm.envBool("MONAD_TESTNET_OPERATOR_TRADES_ENABLED")
                || !vm.envBool("MONAD_TESTNET_PERPL_DIRECT_EXECUTION_ENABLED")
        ) revert("Perpl deployment gates are off");
        if (vm.envBool("LIVE_EXECUTION_ENABLED") || vm.envBool("MAINNET_VENUE_SETUP_ENABLED")) {
            revert("live and mainnet gates must remain off");
        }
    }

    function _writeDraft(address factory, address administrator, address operator, string memory revision) private {
        string memory header = string.concat(
            '{"schemaVersion":1,"network":"monad-testnet","chainId":10143,',
            '"deploymentStatus":"draft","verified":false,"enrollmentEnabled":false,',
            '"policy":{"version":2,"collateralSymbol":"AUSD","collateralDecimals":6,',
            '"minAccountCreationFunding":"100000000","maxMarketsPerRun":16,"perOrderLimitsEnforcedOnchain":false}'
        );
        string memory addresses = _addressesJson(factory, administrator, operator);
        string memory hashes = _hashesJson(factory);
        string memory source = _sourceJson(revision);
        string memory manifest = string.concat(
            header,
            ",",
            addresses,
            ",",
            hashes,
            ",",
            source,
            ',"deploymentTxHashes":{"status":"pending_receipt_verification","items":[]}}'
        );
        vm.writeFile("../../.data/perpl-strategy-manifest.draft.json", manifest);
    }

    function _addressesJson(address factory, address administrator, address operator) private pure returns (string memory) {
        return string.concat(
            '"addresses":{"administrator":"',
            vm.toString(administrator),
            '","operator":"',
            vm.toString(operator),
            '","collateralToken":"',
            vm.toString(PerplTestnetRegistry.AUSD),
            '","delegatedAccountFactory":"',
            vm.toString(PerplTestnetRegistry.DELEGATED_ACCOUNT_FACTORY),
            '","exchange":"',
            vm.toString(PerplTestnetRegistry.EXCHANGE),
            '","factory":"',
            vm.toString(factory),
            '"}'
        );
    }

    function _hashesJson(address factory) private view returns (string memory) {
        return string.concat(
            '"codeHashes":{"factory":"',
            vm.toString(keccak256(factory.code)),
            '","collateralToken":"',
            vm.toString(keccak256(PerplTestnetRegistry.AUSD.code)),
            '","delegatedAccountFactory":"',
            vm.toString(keccak256(PerplTestnetRegistry.DELEGATED_ACCOUNT_FACTORY.code)),
            '","exchange":"',
            vm.toString(keccak256(PerplTestnetRegistry.EXCHANGE.code)),
            '"}'
        );
    }

    function _sourceJson(string memory revision) private view returns (string memory) {
        return string.concat(
            '"source":{"revision":"',
            revision,
            '","solc":"0.8.26","foundry":"v1.8.4","foundryTomlHash":"',
            vm.toString(keccak256(bytes(vm.readFile("foundry.toml")))),
            '"}'
        );
    }
}
