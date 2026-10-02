// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ManagedSpotVaultFactory} from "../src/ManagedSpotVaultFactory.sol";
import {ManagedSpotVault} from "../src/ManagedSpotVault.sol";

interface VmFactory {
    function prank(address caller) external;
    function expectRevert(bytes4 selector) external;
}

contract ManagedSpotVaultFactoryTest {
    VmFactory private constant vm = VmFactory(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant DEPLOYER = address(0xD0E);
    address private constant MAGIC_OWNER = address(0xA11CE);
    address private constant EXECUTOR = address(0xB0B);
    address private constant USDC = address(0x1);
    address private constant WETH = address(0x2);
    address private constant ROUTER = address(0x3);
    bytes32 private constant MANDATE = keccak256("magic-owner-mandate");
    bytes32 private constant PROGRAM = keccak256("program-v1");
    bytes32 private constant POLICY = keccak256("policy-v1");

    ManagedSpotVaultFactory private factory;

    function setUp() public {
        factory = new ManagedSpotVaultFactory(DEPLOYER, USDC, WETH, ROUTER);
    }

    function testOnlyDeployerCanCreateMagicOwnedVault() public {
        vm.expectRevert(ManagedSpotVaultFactory.Unauthorized.selector);
        factory.deploy(MANDATE, MAGIC_OWNER, EXECUTOR, PROGRAM, POLICY,
            200, 40, uint64(block.timestamp + 7 days));

        vm.prank(DEPLOYER);
        address deployed = factory.deploy(MANDATE, MAGIC_OWNER, EXECUTOR, PROGRAM, POLICY,
            200, 40, uint64(block.timestamp + 7 days));
        assert(deployed == factory.vaultByMandate(MANDATE));
        assert(ManagedSpotVault(deployed).owner() == MAGIC_OWNER);
        assert(ManagedSpotVault(deployed).executor() == EXECUTOR);
        assert(address(ManagedSpotVault(deployed).usdc()) == USDC);
        assert(ManagedSpotVault(deployed).capitalUnits() == 200);
    }

    function testRetryReturnsSameVaultAfterUnknownResponse() public {
        vm.prank(DEPLOYER);
        address first = factory.deploy(MANDATE, MAGIC_OWNER, EXECUTOR, PROGRAM, POLICY,
            200, 40, uint64(block.timestamp + 7 days));
        vm.prank(DEPLOYER);
        address second = factory.deploy(MANDATE, MAGIC_OWNER, EXECUTOR, PROGRAM, POLICY,
            200, 40, uint64(block.timestamp + 7 days));
        assert(first == second);
    }
}
