// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PerpTestBase} from "./PerpTestBase.sol";
import {PerpVault} from "../../src/perp/PerpVault.sol";
import {PerpClearinghouseBase} from "../../src/perp/PerpClearinghouseBase.sol";

contract PerpOrdersAndFundingTest is PerpTestBase {
    function testLimitOrderCanAmendAndFillAtOnchainMark() public {
        PerpVault vault = _enroll(OWNER_KEY, 1e6, 600, 301);
        uint256 entry = clearinghouse.currentPrice(0);
        bytes32 id = keccak256("limit-entry");
        vm.prank(OPERATOR);
        vault.submitEntry(id, 0, true, 2, 1e6, entry / 2, 0, uint64(block.timestamp + 300));
        assertEq(clearinghouse.currentMargin(address(vault)), 0);
        assertEq(clearinghouse.userCollateralTotal(), 1e6);
        assertEq(clearinghouse.reserveCommitted(), 0);
        vm.prank(OPERATOR);
        vault.amendLimit(id, entry + entry / 100, uint64(block.timestamp + 300));
        vm.prank(OPERATOR); vault.fillLimit(id);
        assertEq(clearinghouse.currentMargin(address(vault)), 1e6);
        assertEq(clearinghouse.reserveCommitted(), 4e6);
    }

    function testLimitCancelReturnsEscrowAndDuplicateIdsAreRejected() public {
        PerpVault vault = _enroll(OWNER_KEY, 1e6, 600, 302);
        uint256 entry = clearinghouse.currentPrice(0);
        bytes32 id = keccak256("cancel-limit");
        vm.prank(OPERATOR);
        vault.submitEntry(id, 0, true, 2, 1e6, entry / 2, 0, uint64(block.timestamp + 300));
        vm.prank(OPERATOR); vault.cancelPending(id);
        assertEq(circle.balanceOf(address(vault)), 1e6);
        assertEq(clearinghouse.userCollateralTotal(), 0);
        assertEq(clearinghouse.reserveCommitted(), 0);
        vm.expectRevert(PerpVault.InvalidOrder.selector);
        vm.prank(OPERATOR);
        vault.submitEntry(id, 0, true, 2, 1e6, 0, entry, uint64(block.timestamp + 30));
    }

    function testExpiryCancelsLimitAndReturnsFundsToOwner() public {
        PerpVault vault = _enroll(OWNER_KEY, 1e6, 600, 303);
        uint256 entry = clearinghouse.currentPrice(0);
        uint64 expiry = vault.expiresAt();
        vm.prank(OPERATOR);
        vault.submitEntry(keccak256("pending-at-expiry"), 0, true, 2, 1e6,
            entry / 2, 0, expiry);
        vm.warp(vault.expiresAt());
        vm.prank(OPERATOR); vault.settleExpired(keccak256("expiry-settlement"));
        assertEq(uint256(vault.status()), uint256(PerpVault.RunStatus.Expired));
        assertEq(circle.balanceOf(vm.addr(OWNER_KEY)), 1e6);
        assertEq(clearinghouse.userCollateralTotal(), 0);
        assertEq(factory.activeVault(vm.addr(OWNER_KEY)), address(0));
    }

    function testPositiveRateChargesLongAndCannotChangeDuringOpenPosition() public {
        vm.prank(OPERATOR); clearinghouse.setFundingRate(500);
        PerpVault vault = _enroll(OWNER_KEY, 1e6, 120 minutes, 304);
        _market(vault, keccak256("fund-long"), 0, true, 2, 1e6);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(OPERATOR); vault.accrueFunding(keccak256("funding-checkpoint"));
        (,,,,,,,int256 funding,,,,) = clearinghouse.position(address(vault));
        assertTrue(funding < 0);
        vm.expectRevert(PerpClearinghouseBase.OpenPositionsExist.selector);
        vm.prank(OPERATOR); clearinghouse.setFundingRate(-500);
        uint256 mark = clearinghouse.currentPrice(0);
        vm.prank(OPERATOR);
        vault.closePosition(keccak256("fund-long-close"), mark, uint64(block.timestamp + 30));
        assertTrue(circle.balanceOf(address(vault)) < 1e6);
        assertEq(clearinghouse.openPositionCount(), 0);
    }

    function testFundingRunsInBothDirectionsAndCreditsShortsWithinReserve() public {
        vm.prank(OPERATOR); clearinghouse.setFundingRate(500);
        PerpVault shortVault = _enroll(OWNER_KEY, 1e6, 120 minutes, 305);
        _market(shortVault, keccak256("fund-short"), 1, false, 2, 1e6);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(OPERATOR); shortVault.accrueFunding(keccak256("short-funding"));
        (,,,,,,,int256 shortFunding,,,,) = clearinghouse.position(address(shortVault));
        assertTrue(shortFunding > 0);
        uint256 shortMark = clearinghouse.currentPrice(1);
        vm.prank(OPERATOR);
        shortVault.closePosition(keccak256("short-funding-close"), shortMark, uint64(block.timestamp + 30));
        assertTrue(circle.balanceOf(address(shortVault)) > 1e6);

        vm.prank(OPERATOR); clearinghouse.setFundingRate(-500);
        uint256 secondKey = 0xB0B1;
        PerpVault longVault = _enroll(secondKey, 1e6, 120 minutes, 306);
        _market(longVault, keccak256("negative-rate-long"), 2, true, 2, 1e6);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(OPERATOR); longVault.accrueFunding(keccak256("negative-rate-checkpoint"));
        (,,,,,,,int256 longFunding,,,,) = clearinghouse.position(address(longVault));
        assertTrue(longFunding > 0);
    }
}


