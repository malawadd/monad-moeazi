// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PerpTestBase} from "./PerpTestBase.sol";
import {AutonomyTypes} from "../../src/autonomy/AutonomyTypes.sol";
import {PerpMandate} from "../../src/perp/PerpMandate.sol";
import {PerpVault} from "../../src/perp/PerpVault.sol";
import {PerpClearinghouseBase} from "../../src/perp/PerpClearinghouseBase.sol";
import {PerpVaultFactory} from "../../src/perp/PerpVaultFactory.sol";

contract PerpEnrollmentTest is PerpTestBase {
    function testAtomicCircleFundingAndMandateEnrollment() public {
        (AutonomyTypes.CircleAuthorization memory auth, PerpMandate.Mandate memory mandate,
            bytes memory signature) = _prepare(OWNER_KEY, 1e6, 600, 101);
        address owner = vm.addr(OWNER_KEY);
        PerpVault vault = PerpVault(factory.createAndEnroll(auth, mandate, signature));
        assertEq(vault.owner(), owner);
        assertEq(uint256(vault.status()), uint256(PerpVault.RunStatus.Active));
        assertEq(circle.balanceOf(address(vault)), 1e6);
        assertEq(factory.activeVault(owner), address(vault));
        assertEq(factory.enrollmentNonce(owner), 1);
        assertTrue(clearinghouse.registeredVault(address(vault)));
        assertEq(clearinghouse.vaultExpiresAt(address(vault)), vault.expiresAt());
    }

    function testFactoryEnrollmentIsDefaultOffAndAtomicOnFailure() public {
        vm.prank(OPERATOR); factory.setEnrollmentEnabled(false);
        (AutonomyTypes.CircleAuthorization memory auth, PerpMandate.Mandate memory mandate,
            bytes memory signature) = _prepare(OWNER_KEY, 1e6, 600, 102);
        vm.expectRevert(PerpVaultFactory.EnrollmentDisabled.selector);
        factory.createAndEnroll(auth, mandate, signature);
        assertEq(circle.balanceOf(vm.addr(OWNER_KEY)), 1e6);
        assertEq(circle.balanceOf(mandate.vault), 0);
        assertEq(factory.enrollmentNonce(mandate.owner), 0);
    }

    function testInsufficientReserveBlocksEntryWithoutMovingUserCollateral() public {
        vm.prank(OPERATOR); clearinghouse.withdrawReserve(10e6);
        PerpVault vault = _enroll(OWNER_KEY, 1e6, 600, 103);
        uint256 mark = clearinghouse.currentPrice(0);
        vm.expectRevert(PerpClearinghouseBase.InsufficientReserve.selector);
        vm.prank(OPERATOR);
        vault.submitEntry(keccak256("blocked"), 0, true, 2, 1e6, 0, mark, uint64(block.timestamp + 30));
        assertEq(circle.balanceOf(address(vault)), 1e6);
        assertEq(clearinghouse.userCollateralTotal(), 0);
        assertEq(clearinghouse.reserveCommitted(), 0);
        assertEq(clearinghouse.operatorReserve(), 0);
    }

    function testReserveCannotBeWithdrawnWhileCommitted() public {
        PerpVault vault = _enroll(OWNER_KEY, 1e6, 600, 104);
        _market(vault, keccak256("entry"), 0, true, 2, 1e6);
        assertEq(clearinghouse.reserveCommitted(), 4e6);
        vm.expectRevert(PerpClearinghouseBase.InsufficientReserve.selector);
        vm.prank(OPERATOR); clearinghouse.withdrawReserve(7e6);
        assertEq(clearinghouse.operatorReserve(), 10e6);
    }

    function testMandateRejectsNonPolicyFundingAndDuration() public {
        (AutonomyTypes.CircleAuthorization memory auth, PerpMandate.Mandate memory mandate,
            bytes memory signature) = _prepare(OWNER_KEY, 1e6, 600, 105);
        mandate.durationSeconds = 9 minutes;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, factory.mandateDigest(mandate));
        signature = abi.encodePacked(r, s, v);
        vm.expectRevert(PerpVaultFactory.InvalidMandate.selector);
        factory.createAndEnroll(auth, mandate, signature);
        assertEq(circle.balanceOf(vm.addr(OWNER_KEY)), 1e6);
        assertEq(circle.balanceOf(mandate.vault), 0);
    }
}
