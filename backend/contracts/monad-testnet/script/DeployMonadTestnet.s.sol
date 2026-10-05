// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MoeaziTestnetVault} from "../src/MoeaziTestnetVault.sol";
import {MoeaziTestAmmAdapter} from "../src/MoeaziTestAmmAdapter.sol";
import {UniswapV4NoHookAdapter} from "../src/UniswapV4NoHookAdapter.sol";
import {V4NoHookPoolSeeder} from "../src/V4NoHookPoolSeeder.sol";
import {MonadTestnetRegistry} from "../src/MonadTestnetRegistry.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

interface VmDeploy {
    function envAddress(string calldata key) external returns (address);
    function envString(string calldata key) external returns (string memory);
    function startBroadcast() external;
    function stopBroadcast() external;
    function toString(address value) external pure returns (string memory);
    function toString(bytes32 value) external pure returns (string memory);
    function toString(uint256 value) external pure returns (string memory);
    function toString(int256 value) external pure returns (string memory);
    function readFile(string calldata path) external view returns (string memory);
    function writeJson(string calldata json, string calldata path) external;
}

/// @notice Deploys contracts only. It never seeds liquidity or submits swap orders.
contract DeployMonadTestnet {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    VmDeploy private constant vm = VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Deployment {
        address owner;
        address executor;
        address operator;
        address vault;
        address amm;
        address v4;
        address seeder;
    }

    function run() external returns (address vault, address amm, address v4, address seeder) {
        Deployment memory d = _deploy();
        string memory revision = vm.envString("MONAD_SOURCE_REVISION");
        string memory path = vm.envString("MONAD_DEPLOYMENT_MANIFEST");
        require(bytes(revision).length != 0, "source revision required");
        _writeManifest(d, revision, path);
        return (d.vault, d.amm, d.v4, d.seeder);
    }

    function _deploy() private returns (Deployment memory d) {
        d.owner = vm.envAddress("MONAD_OWNER_ADDRESS");
        d.executor = vm.envAddress("MONAD_EXECUTOR_ADDRESS");
        d.operator = vm.envAddress("MONAD_OPERATOR_ADDRESS");
        require(d.owner != address(0) && d.operator != address(0), "owner/operator required");
        vm.startBroadcast();
        d.amm = address(new MoeaziTestAmmAdapter(d.operator));
        d.v4 = address(new UniswapV4NoHookAdapter());
        d.seeder = address(new V4NoHookPoolSeeder(d.operator));
        address[] memory adapters = new address[](2);
        adapters[0] = d.amm;
        adapters[1] = d.v4;
        d.vault = address(new MoeaziTestnetVault(d.owner, d.executor, adapters));
        vm.stopBroadcast();
    }

    function _writeManifest(Deployment memory d, string memory revision, string memory path) private {
        PoolKey memory key = UniswapV4NoHookAdapter(d.v4).poolKey();
        IPoolManager manager = IPoolManager(MonadTestnetRegistry.V4_POOL_MANAGER);
        (uint160 sqrtPrice, int24 tick,,) = manager.getSlot0(key.toId());
        uint128 liquidity = manager.getLiquidity(key.toId());
        string memory status = sqrtPrice == 0 ? "uninitialized" : "initialized";
        string memory json = string.concat(
            '{"schemaVersion":1,"network":"monad-testnet","chainId":10143,',
            '"deploymentStatus":"draft; verify receipts before marking complete",',
            _addressesJson(d), ',', _hashesJson(d), ',', _sourceJson(revision), ',',
            _poolJson(status, sqrtPrice, tick, liquidity), '}'
        );
        vm.writeJson(json, path);
    }

    function _addressesJson(Deployment memory d) private returns (string memory) {
        return string.concat(
            '"addresses":{"vault":"', vm.toString(d.vault), '","owner":"', vm.toString(d.owner),
            '","executor":"', vm.toString(d.executor), '","adapterOwner":"', vm.toString(d.operator),
            '","moeaziAmmAdapter":"', vm.toString(d.amm), '","uniswapV4Adapter":"',
            vm.toString(d.v4), '","v4Seeder":"', vm.toString(d.seeder), '"}'
        );
    }

    function _hashesJson(Deployment memory d) private view returns (string memory) {
        return string.concat(
            '"codeHashes":{"vault":"', vm.toString(keccak256(d.vault.code)),
            '","moeaziAmmAdapter":"', vm.toString(keccak256(d.amm.code)),
            '","uniswapV4Adapter":"', vm.toString(keccak256(d.v4.code)),
            '","v4Seeder":"', vm.toString(keccak256(d.seeder.code)), '"}'
        );
    }

    function _sourceJson(string memory revision) private returns (string memory) {
        bytes32 sourceHash = keccak256(abi.encode(
            keccak256(bytes(vm.readFile("foundry.toml"))),
            keccak256(bytes(vm.readFile("src/MonadTestnetRegistry.sol"))),
            keccak256(bytes(vm.readFile("src/SafeToken.sol"))),
            keccak256(bytes(vm.readFile("src/MeraMandate.sol"))),
            keccak256(bytes(vm.readFile("src/MoeaziTestnetVault.sol"))),
            keccak256(bytes(vm.readFile("src/MoeaziTestAmmAdapter.sol"))),
            keccak256(bytes(vm.readFile("src/UniswapV4NoHookAdapter.sol"))),
            keccak256(bytes(vm.readFile("src/V4NoHookPoolSeeder.sol")))
        ));
        return string.concat(
            '"source":{"revision":"', revision,
            '","foundry":"v1.8.4","solc":"0.8.26","evmVersion":"cancun",',
            '"optimizer":true,"optimizerRuns":10000,"contractSourceHash":"', vm.toString(sourceHash),
            '","uniswapV4Core":"1.0.2","uniswapV4Periphery":"1.0.3",',
            '"uniswapV4CoreIntegrity":"sha512-X15Tm2wWd+USAzEExMbo+g9naA6QN6mPgWm0MzDwRNlOfaNlepfUpSyt9RSrUfEODspwbyWbcLg6t5nwc/e7lg==",',
            '"uniswapV4PeripheryIntegrity":"sha512-JxLL0Djv9XcMvI2PatEnWrCrxuEaYNVhHxstndBOP+aJfh1XLg5ec8SDZ0xyoVfg2ElJTvuKpBgnu90bNValsg==",',
            '"dependencyLock":"backend/execution-sidecar/package-lock.json"}'
        );
    }

    function _poolJson(string memory status, uint160 sqrtPrice, int24 tick, uint128 liquidity)
        private returns (string memory)
    {
        return string.concat(
            '"deploymentTxHashes":{"status":"pending receipt verification","items":[]},',
            '"v4Pool":{"status":"', status, '","manager":"',
            vm.toString(MonadTestnetRegistry.V4_POOL_MANAGER), '","fee":3000,"tickSpacing":60,',
            '"hooks":"0x0000000000000000000000000000000000000000","sqrtPriceX96":"',
            vm.toString(uint256(sqrtPrice)), '","tick":"', vm.toString(int256(tick)),
            '","liquidity":"', vm.toString(uint256(liquidity)), '"}'
        );
    }
}
