// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AutonomyTestBase} from "./AutonomyTestBase.sol";
import {AutonomyTypes} from "../../src/autonomy/AutonomyTypes.sol";
import {AutonomyMandate} from "../../src/autonomy/AutonomyMandate.sol";
import {MoeaziAutonomousVault} from "../../src/autonomy/MoeaziAutonomousVault.sol";
import {AutonomousVaultFactory} from "../../src/autonomy/AutonomousVaultFactory.sol";
import {AutonomousVaultBase} from "../../src/autonomy/AutonomousVaultBase.sol";
import {MockCircleUSDC} from "./MockCircleUSDC.sol";
import {FixedSupplyMockToken} from "../../src/autonomy/FixedSupplyMockToken.sol";

contract AutonomyEnrollmentTest is AutonomyTestBase {
    function testEnrollmentIsOffByDefaultAndAtomicReceiveIsPayeeOnly() public {
        vm.prank(OPERATOR);
        factory.setEnrollmentEnabled(false);
        (AutonomyTypes.CircleAuthorization memory auth, AutonomyMandate.StrategyMandate memory mandate,
            bytes memory signature) = _prepare(OWNER_KEY, 1e6, 600, 100, 100, 11);
        address predicted = factory.predictVault(mandate.owner, mandate.nonce);
        assertEq(predicted, auth.to);
        uint256 ownerBefore = circle.balanceOf(mandate.owner);
        vm.expectRevert(AutonomousVaultFactory.EnrollmentDisabled.selector);
        factory.createAndEnroll(auth, mandate, signature);
        assertEq(circle.balanceOf(mandate.owner), ownerBefore);
        assertFalse(circle.authorizationState(mandate.owner, auth.nonce));

        vm.prank(OPERATOR);
        factory.setEnrollmentEnabled(true);
        vm.expectRevert(MockCircleUSDC.UnauthorizedPayee.selector);
        _receiveCircleAuth(auth);
        assertFalse(circle.authorizationState(mandate.owner, auth.nonce));
        address vaultAddress = factory.createAndEnroll(auth, mandate, signature);
        MoeaziAutonomousVault vault = MoeaziAutonomousVault(vaultAddress);
        assertEq(vaultAddress, predicted);
        assertEq(circle.balanceOf(vaultAddress), 1e6);
        assertEq(circle.balanceOf(mandate.owner), ownerBefore - 1e6);
        assertTrue(circle.authorizationState(mandate.owner, auth.nonce));
        assertEq(vault.expiresAt(), uint64(block.timestamp + 600));

        vm.expectRevert(MockCircleUSDC.AuthorizationAlreadyUsed.selector);
        vm.prank(vaultAddress);
        _receiveCircleAuth(auth);
        vm.expectRevert(AutonomousVaultFactory.InvalidMandate.selector);
        factory.createAndEnroll(auth, mandate, signature);
    }

    function testSeparateOwnersGetSeparateVaultsAndFunding() public {
        (MoeaziAutonomousVault first,,,) = _enroll(OWNER_KEY, 1e6, 600, 100, 100, 21);
        uint256 secondKey = 0xB0B1;
        (MoeaziAutonomousVault second,,,) = _enroll(secondKey, 2e6, 900, 150, 150, 22);
        assertTrue(address(first) != address(second));
        assertEq(first.owner(), vm.addr(OWNER_KEY));
        assertEq(second.owner(), vm.addr(secondKey));
        assertEq(circle.balanceOf(address(first)), 1e6);
        assertEq(circle.balanceOf(address(second)), 2e6);
        assertEq(first.mandateNonce(), 0);
        assertEq(second.mandateNonce(), 0);
        assertEq(factory.enrollmentNonce(vm.addr(OWNER_KEY)), 1);
        assertEq(factory.enrollmentNonce(vm.addr(secondKey)), 1);
    }

    function testWrongChainAmountAndCycleMandatesAreRejectedBeforeFunding() public {
        (AutonomyTypes.CircleAuthorization memory auth, AutonomyMandate.StrategyMandate memory mandate,
            bytes memory signature) = _prepare(OWNER_KEY, 1e6, 600, 100, 100, 31);
        mandate.chainId = 1;
        vm.expectRevert(AutonomousVaultFactory.InvalidMandate.selector);
        factory.createAndEnroll(auth, mandate, signature);
        assertFalse(circle.authorizationState(mandate.owner, auth.nonce));

        (auth, mandate, signature) = _prepare(OWNER_KEY, 1e6, 600, 100, 100, 32);
        mandate.maxCycles = 4;
        vm.expectRevert(AutonomousVaultFactory.InvalidMandate.selector);
        factory.createAndEnroll(auth, mandate, signature);

        (auth, mandate, signature) = _prepare(OWNER_KEY, 99_999, 600, 100, 100, 33);
        vm.expectRevert(AutonomousVaultFactory.InvalidMandate.selector);
        factory.createAndEnroll(auth, mandate, signature);
        assertFalse(circle.authorizationState(mandate.owner, auth.nonce));
    }

    function testWrongChainDeploymentIsRejected() public {
        vm.chainId(1);
        vm.expectRevert(AutonomousVaultFactory.WrongChain.selector);
        new AutonomousVaultFactory(OPERATOR, OPERATOR, USDC, tokens, pools);
    }

    function testInvalidCircleSignatureRollsBackVaultDeploymentAndNonce() public {
        (AutonomyTypes.CircleAuthorization memory auth, AutonomyMandate.StrategyMandate memory mandate,
            bytes memory signature) = _prepare(OWNER_KEY, 1e6, 600, 100, 100, 35);
        auth.r = bytes32(uint256(auth.r) ^ 1);
        uint256 ownerBalance = circle.balanceOf(mandate.owner);
        address predicted = auth.to;
        vm.expectRevert(MockCircleUSDC.InvalidSignature.selector);
        factory.createAndEnroll(auth, mandate, signature);
        assertEq(circle.balanceOf(mandate.owner), ownerBalance);
        assertFalse(circle.authorizationState(mandate.owner, auth.nonce));
        assertEq(predicted.code.length, 0);
        assertEq(factory.enrollmentNonce(mandate.owner), 0);
    }

    function testOperatorHasNoWithdrawalOrRecoveryAuthority() public {
        (MoeaziAutonomousVault vault,,,) = _enroll(OWNER_KEY, 1e6, 600, 100, 100, 41);
        (bool hasWithdraw,) = address(vault).call(abi.encodeWithSignature(
            "withdraw(address,uint256)", USDC, 1
        ));
        assertFalse(hasWithdraw);
        vm.expectRevert(AutonomousVaultBase.Unauthorized.selector);
        vm.prank(OPERATOR);
        vault.emergencyRecover();
        vm.prank(vm.addr(OWNER_KEY));
        vault.emergencyRecover();
        assertEq(uint256(vault.settlementStatus()), uint256(AutonomousVaultBase.SettlementStatus.EmergencyRecovered));
        assertEq(circle.balanceOf(address(vault)), 0);
        assertEq(circle.balanceOf(vm.addr(OWNER_KEY)), 1e6);
    }

    function testOwnerEmergencyReturnsBothUsdcAndOpenPosition() public {
        (MoeaziAutonomousVault vault,,,) = _enroll(OWNER_KEY, 2e6, 600, 500, 500, 42);
        uint256 quote = _quote(pools[1], USDC, tokens[1], 1e6);
        vm.prank(OPERATOR);
        vault.buy(keccak256("emergency position"), 1, 1e6, quote);
        uint256 position = vault.positionAmount();
        vm.prank(vm.addr(OWNER_KEY));
        vault.emergencyRecover();
        assertEq(uint256(vault.settlementStatus()), uint256(AutonomousVaultBase.SettlementStatus.EmergencyRecovered));
        assertEq(circle.balanceOf(vm.addr(OWNER_KEY)), 1e6);
        assertEq(FixedSupplyMockToken(tokens[1]).balanceOf(vm.addr(OWNER_KEY)), position);
    }
}
