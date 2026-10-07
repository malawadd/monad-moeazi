// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Minimal} from "../src/MonadTestnetRegistry.sol";
import {MonadTestnetRegistry} from "../src/MonadTestnetRegistry.sol";
import {FixedSupplyMockToken} from "../src/autonomy/FixedSupplyMockToken.sol";
import {MoeaziTestPairPool} from "../src/autonomy/MoeaziTestPairPool.sol";
import {AutonomousVaultFactory} from "../src/autonomy/AutonomousVaultFactory.sol";

interface VmAutonomyDeploy {
    function envAddress(string calldata key) external returns (address);
    function envString(string calldata key) external returns (string memory);
    function startBroadcast() external;
    function stopBroadcast() external;
    function toString(address value) external pure returns (string memory);
    function toString(bytes32 value) external pure returns (string memory);
    function toString(uint256 value) external pure returns (string memory);
    function readFile(string calldata path) external view returns (string memory);
    function writeJson(string calldata json, string calldata path) external;
}

/// @notice Deploys and seeds three small scenario pools; enrollment remains disabled.
contract DeployAutonomyTestnet {
    VmAutonomyDeploy private constant vm = VmAutonomyDeploy(
        address(uint160(uint256(keccak256("hevm cheat code"))))
    );
    uint256 private constant TOKEN_SUPPLY = 1_000_000 ether;
    uint256 private constant USDC_SEED_PER_POOL = 6e6;
    uint256 private constant TOKEN_SEED_PER_USDC_RAW = 1e15;

    struct Deployment {
        address operator;
        address executor;
        address[3] tokens;
        address[3] pools;
        address factory;
    }

    function run() external returns (address factory) {
        Deployment memory d = _deployAndSeed();
        string memory revision = vm.envString("MONAD_SOURCE_REVISION");
        require(bytes(revision).length != 0, "source revision required");
        _writeDraftManifest(d, revision);
        return d.factory;
    }

    function _deployAndSeed() private returns (Deployment memory d) {
        d.operator = vm.envAddress("MONAD_AUTONOMY_OPERATOR_ADDRESS");
        d.executor = vm.envAddress("MONAD_AUTONOMY_EXECUTOR_ADDRESS");
        require(d.operator != address(0) && d.executor != address(0), "operator/executor required");
        require(IERC20Minimal(MonadTestnetRegistry.USDC).balanceOf(d.operator) >= 3 * USDC_SEED_PER_POOL,
            "operator needs 18 USDC for seed");
        vm.startBroadcast();
        _deployPools(d);
        d.factory = address(new AutonomousVaultFactory(
            d.operator, d.executor, MonadTestnetRegistry.USDC, d.tokens, d.pools
        ));
        vm.stopBroadcast();
    }

    function _deployPools(Deployment memory d) private {
        string[3] memory names = ["Moeazi Alpha", "Moeazi Beta", "Moeazi Gamma"];
        string[3] memory symbols = ["MZA", "MZB", "MZG"];
        for (uint8 i; i < 3; ++i) {
            FixedSupplyMockToken token = new FixedSupplyMockToken(names[i], symbols[i], d.operator, TOKEN_SUPPLY);
            MoeaziTestPairPool pool = new MoeaziTestPairPool(
                d.operator, MonadTestnetRegistry.USDC, address(token)
            );
            uint256 tokenSeed = USDC_SEED_PER_POOL * TOKEN_SEED_PER_USDC_RAW;
            require(IERC20Minimal(MonadTestnetRegistry.USDC).approve(address(pool), USDC_SEED_PER_POOL),
                "USDC approve failed");
            require(token.approve(address(pool), tokenSeed), "token approve failed");
            pool.addLiquidity(USDC_SEED_PER_POOL, tokenSeed);
            d.tokens[i] = address(token);
            d.pools[i] = address(pool);
        }
    }

    function _writeDraftManifest(Deployment memory d, string memory revision) private {
        string memory json = string.concat(
            '{"schemaVersion":1,"network":"monad-testnet","chainId":10143,',
            '"deploymentStatus":"draft; verify broadcast receipts before enabling",',
            '"verified":false,"enrollmentEnabled":false,', _addressesJson(d), ',', _hashesJson(d), ',',
            '"seed":{"usdcPerPool":"6000000","tokensPerPool":"6000000000000000000000"},',
            '"source":{"revision":"', revision, '","solc":"0.8.26","foundry":"v1.8.4",',
            '"foundryTomlHash":"', vm.toString(keccak256(bytes(vm.readFile("foundry.toml")))), '"},',
            '"deploymentTxHashes":{"status":"pending receipt verification","items":[]}}'
        );
        vm.writeJson(json, "../../.data/monad-autonomy-manifest.draft.json");
    }

    function _addressesJson(Deployment memory d) private returns (string memory) {
        return string.concat('"addresses":{"administrator":"', vm.toString(d.operator),
            '","executor":"', vm.toString(d.executor), '","usdc":"',
            vm.toString(MonadTestnetRegistry.USDC), '","factory":"', vm.toString(d.factory),
            '","tokens":[', _tokenJson(d, 0), ',', _tokenJson(d, 1), ',', _tokenJson(d, 2), ']}');
    }

    function _hashesJson(Deployment memory d) private returns (string memory) {
        return string.concat('"codeHashes":{"factory":"', vm.toString(keccak256(d.factory.code)),
            '","tokens":', _hashes(d.tokens), ',"pools":', _hashes(d.pools), '}');
    }

    function _hashes(address[3] memory targets) private returns (string memory) {
        return string.concat('["', vm.toString(keccak256(targets[0].code)), '","',
            vm.toString(keccak256(targets[1].code)), '","', vm.toString(keccak256(targets[2].code)), '"]');
    }

    function _tokenJson(Deployment memory d, uint8 i) private returns (string memory) {
        string memory name = i == 0 ? "Moeazi Alpha" : i == 1 ? "Moeazi Beta" : "Moeazi Gamma";
        string memory symbol = i == 0 ? "MZA" : i == 1 ? "MZB" : "MZG";
        return string.concat('{"index":', vm.toString(uint256(i)), ',"name":"', name,
            '","symbol":"', symbol, '","address":"', vm.toString(d.tokens[i]),
            '","pool":"', vm.toString(d.pools[i]), '"}');
    }
}
