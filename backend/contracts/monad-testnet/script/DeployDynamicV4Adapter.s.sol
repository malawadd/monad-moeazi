// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UniswapV4DynamicNoHookAdapter} from "../src/UniswapV4DynamicNoHookAdapter.sol";

interface VmDynamicV4Deploy {
    function envString(string calldata key) external returns (string memory);
    function startBroadcast() external;
    function stopBroadcast() external;
    function readFile(string calldata path) external view returns (string memory);
    function writeFile(string calldata path, string calldata contents) external;
    function toString(address value) external pure returns (string memory);
    function toString(bytes32 value) external pure returns (string memory);
}

/// @notice Deploys only the dynamic wallet v4 adapter and writes a separate draft addendum.
contract DeployDynamicV4Adapter {
    VmDynamicV4Deploy private constant vm = VmDynamicV4Deploy(
        address(uint160(uint256(keccak256("hevm cheat code"))))
    );

    function run() external returns (address adapterAddress) {
        require(block.chainid == 10143, "Monad Testnet 10143 required");
        string memory revision = vm.envString("MONAD_SOURCE_REVISION");
        require(bytes(revision).length != 0, "source revision required");

        vm.startBroadcast();
        UniswapV4DynamicNoHookAdapter adapter = new UniswapV4DynamicNoHookAdapter();
        vm.stopBroadcast();
        adapterAddress = address(adapter);

        string memory manifest = string.concat(
            '{"schemaVersion":1,"network":"monad-testnet","chainId":10143,',
            '"deploymentStatus":"draft; verify Foundry receipt before configuring",',
            '"verified":false,"addresses":{"uniswapV4DynamicAdapter":"',
            vm.toString(adapterAddress), '"},"codeHashes":{"uniswapV4DynamicAdapter":"',
            vm.toString(keccak256(adapterAddress.code)), '"},',
            _sourceJson(revision),
            ',"deploymentReceipt":{"status":"pending Foundry receipt verification",',
            '"txHash":null,"blockNumber":null},',
            '"poolManager":"0x451D64ab3b650040d2aE1886602b97ed6eDc643d"}'
        );
        vm.writeFile("../../.data/monad-v4-dynamic-adapter.addendum.draft.json", manifest);
    }

    function _sourceJson(string memory revision) private view returns (string memory) {
        bytes32 sourceHash = keccak256(abi.encode(
            keccak256(bytes(vm.readFile("foundry.toml"))),
            keccak256(bytes(vm.readFile("src/MonadTestnetRegistry.sol"))),
            keccak256(bytes(vm.readFile("src/SafeToken.sol"))),
            keccak256(bytes(vm.readFile("src/UniswapV4DynamicNoHookAdapter.sol")))
        ));
        return string.concat(
            '"source":{"revision":"', revision, '","foundry":"v1.8.4",',
            '"solc":"0.8.26","evmVersion":"cancun","optimizer":true,',
            '"optimizerRuns":10000,"contractSourceHash":"', vm.toString(sourceHash), '"}'
        );
    }
}
