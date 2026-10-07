// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PerpTestBase} from "./PerpTestBase.sol";
import {AutonomyTypes} from "../../src/autonomy/AutonomyTypes.sol";
import {PerpMandate} from "../../src/perp/PerpMandate.sol";
import {PerpVault} from "../../src/perp/PerpVault.sol";
import {PerpVaultFactory} from "../../src/perp/PerpVaultFactory.sol";
import {PerpClearinghouseBase} from "../../src/perp/PerpClearinghouseBase.sol";
import {MockCircleUSDC} from "../autonomy/MockCircleUSDC.sol";
import {MonadTestnetRegistry} from "../../src/MonadTestnetRegistry.sol";

contract PerpAcceptanceEdgesTest is PerpTestBase {
    function testRepeatedCyclesHaveNoThreeCycleCap() public {
        PerpVault vault = _enroll(OWNER_KEY, 1e6, 600, 401);
        for (uint256 i; i < 4; ++i) {
            bytes32 entryId = keccak256(abi.encode("entry", i));
            bytes32 closeId = keccak256(abi.encode("close", i));
            _market(vault, entryId, 0, true, 1, 100_000);
            uint256 mark = clearinghouse.currentPrice(0);
            vm.prank(OPERATOR);
            vault.closePosition(closeId, mark, uint64(block.timestamp + 30));
        }
        assertEq(circle.balanceOf(address(vault)), 1e6);
        assertEq(clearinghouse.openPositionCount(), 0);
        assertEq(clearinghouse.reserveCommitted(), 0);
        assertEq(clearinghouse.userCollateralTotal(), 0);
    }

    function testSeparateOwnersKeepCollateralAndPositionsIsolated() public {
        uint256 secondKey = 0xB0B2;
        PerpVault first = _enroll(OWNER_KEY, 1e6, 600, 402);
        PerpVault second = _enroll(secondKey, 1e6, 600, 403);
        _market(first, keccak256("first-position"), 0, true, 2, 500_000);
        _market(second, keccak256("second-position"), 2, false, 2, 500_000);
        assertEq(clearinghouse.currentMargin(address(first)), 500_000);
        assertEq(clearinghouse.currentMargin(address(second)), 500_000);
        assertEq(clearinghouse.userCollateralTotal(), 1e6);
        uint64 stopDeadline = uint64(block.timestamp + 60);
        bytes memory stopSig = _signStopAt(first, OWNER_KEY, 0, stopDeadline);
        vm.prank(OPERATOR);
        first.stopWithSignature(0, stopDeadline, stopSig);
        assertEq(clearinghouse.currentMargin(address(first)), 0);
        assertEq(clearinghouse.currentMargin(address(second)), 500_000);
        assertEq(clearinghouse.userCollateralTotal(), 500_000);
        assertEq(uint256(second.status()), uint256(PerpVault.RunStatus.Active));
    }

    function testPayoutIsCappedAtFiveTimesMargin() public {
        PerpVault vault = _enroll(OWNER_KEY, 100_000, 600, 404);
        _market(vault, keccak256("capped-payout-entry"), 0, true, 2, 100_000);
        _movePriceUp(0, 80e6);
        uint256 mark = clearinghouse.currentPrice(0);
        vm.prank(OPERATOR);
        vault.closePosition(keccak256("capped-payout-close"), mark, uint64(block.timestamp + 30));
        assertEq(circle.balanceOf(address(vault)), 500_000);
        assertEq(clearinghouse.operatorReserve(), 9_600_000);
        assertEq(clearinghouse.reserveCommitted(), 0);
    }

    function testCircleAuthorizationAndMandateCannotReplay() public {
        (AutonomyTypes.CircleAuthorization memory auth, PerpMandate.Mandate memory mandate,
            bytes memory signature) = _prepare(OWNER_KEY, 1e6, 600, 405);
        PerpVault vault = PerpVault(factory.createAndEnroll(auth, mandate, signature));
        assertTrue(circle.authorizationState(mandate.owner, auth.nonce));
        vm.expectRevert(MockCircleUSDC.AuthorizationAlreadyUsed.selector);
        vm.prank(address(vault));
        circle.receiveWithAuthorization(auth.from, auth.to, auth.value, auth.validAfter,
            auth.validBefore, auth.nonce, auth.v, auth.r, auth.s);
        uint64 stopDeadline = uint64(block.timestamp + 60);
        bytes memory stopSig = _signStopAt(vault, OWNER_KEY, 0, stopDeadline);
        vm.prank(OPERATOR);
        vault.stopWithSignature(0, stopDeadline, stopSig);
        vm.expectRevert(PerpVaultFactory.InvalidMandate.selector);
        factory.createAndEnroll(auth, mandate, signature);
        assertEq(factory.enrollmentNonce(mandate.owner), 1);
    }

    function testFactoryRejectsWrongChainAtEnrollment() public {
        (AutonomyTypes.CircleAuthorization memory auth, PerpMandate.Mandate memory mandate,
            bytes memory signature) = _prepare(OWNER_KEY, 1e6, 600, 406);
        vm.chainId(1);
        vm.expectRevert(PerpVaultFactory.WrongChain.selector);
        factory.createAndEnroll(auth, mandate, signature);
        vm.chainId(MonadTestnetRegistry.CHAIN_ID);
    }

    function testSignedStopRejectsExpiredAndWrongNonceSignatures() public {
        PerpVault vault = _enroll(OWNER_KEY, 1e6, 600, 407);
        uint64 expired = uint64(block.timestamp + 5);
        bytes memory expiredSig = _signStopAt(vault, OWNER_KEY, 0, expired);
        vm.warp(expired + 1);
        vm.expectRevert(PerpVault.InvalidSignature.selector);
        vm.prank(OPERATOR); vault.stopWithSignature(0, expired, expiredSig);
        bytes memory wrongNonce = _signStop(vault, OWNER_KEY, 1);
        vm.expectRevert(PerpVault.InvalidSignature.selector);
        vm.prank(OPERATOR); vault.stopWithSignature(1, uint64(block.timestamp + 60), wrongNonce);
        uint64 deadline = uint64(block.timestamp + 60);
        bytes memory valid = _signStopAt(vault, OWNER_KEY, 0, deadline);
        vm.prank(OPERATOR); vault.stopWithSignature(0, deadline, valid);
        assertEq(vault.stopNonce(), 1);
        vm.expectRevert(PerpVault.RunInactive.selector);
        vm.prank(OPERATOR); vault.stopWithSignature(0, deadline, valid);
    }
}




