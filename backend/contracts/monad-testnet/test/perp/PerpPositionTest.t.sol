// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PerpTestBase} from "./PerpTestBase.sol";
import {PerpVault} from "../../src/perp/PerpVault.sol";
import {PerpClearinghouseBase} from "../../src/perp/PerpClearinghouseBase.sol";

contract PerpPositionTest is PerpTestBase {
    function testProfitableLongReturnsUsdcToVaultAndSignedStopReturnsWalletFunds() public {
        PerpVault vault = _enroll(OWNER_KEY, 1e6, 600, 201);
        _market(vault, keccak256("long-entry"), 0, true, 2, 1e6);
        uint256 committed = clearinghouse.reserveCommitted();
        assertEq(committed, 4e6);
        _movePriceUp(0, 10e6);
        uint256 mark = clearinghouse.currentPrice(0);
        vm.prank(OPERATOR);
        vault.closePosition(keccak256("long-close"), mark, uint64(block.timestamp + 30));
        uint256 proceeds = circle.balanceOf(address(vault));
        assertTrue(proceeds > 1e6);
        assertEq(clearinghouse.reserveCommitted(), 0);
        assertEq(clearinghouse.userCollateralTotal(), 0);

        bytes memory stopSignature = _signStop(vault, OWNER_KEY, 0);
        vm.prank(OPERATOR); vault.stopWithSignature(0, uint64(block.timestamp + 60), stopSignature);
        assertEq(circle.balanceOf(address(vault)), 0);
        assertEq(circle.balanceOf(vm.addr(OWNER_KEY)), proceeds);
        assertEq(uint256(vault.status()), uint256(PerpVault.RunStatus.Stopped));
        assertEq(factory.activeVault(vm.addr(OWNER_KEY)), address(0));
        assertEq(vault.stopNonce(), 1);
    }

    function testProfitableShortSettlesPnlAgainstPoolMark() public {
        PerpVault vault = _enroll(OWNER_KEY, 1e6, 600, 202);
        _market(vault, keccak256("short-entry"), 1, false, 2, 1e6);
        _movePriceDown(1, 20_000 ether);
        uint256 mark = clearinghouse.currentPrice(1);
        vm.prank(OPERATOR);
        vault.closePosition(keccak256("short-close"), mark, uint64(block.timestamp + 30));
        assertTrue(circle.balanceOf(address(vault)) > 1e6);
        assertEq(clearinghouse.operatorReserve() + circle.balanceOf(address(vault)) - 1e6, 10e6);
    }

    function testLiquidationCannotTakeMoreThanPositionMargin() public {
        PerpVault vault = _enroll(OWNER_KEY, 1e6, 600, 203);
        _market(vault, keccak256("liquidatable"), 2, true, 10, 1e6);
        _movePriceDown(2, 20_000 ether);
        vm.prank(OPERATOR); vault.liquidate(keccak256("liquidation"));
        assertEq(circle.balanceOf(address(vault)), 0);
        assertEq(clearinghouse.currentMargin(address(vault)), 0);
        assertEq(clearinghouse.userCollateralTotal(), 0);
        assertEq(clearinghouse.reserveCommitted(), 0);
        assertEq(clearinghouse.operatorReserve(), 11e6);
    }

    function testMarginChangesAndPartialCloseKeepIsolatedAccounting() public {
        PerpVault vault = _enroll(OWNER_KEY, 2e6, 600, 204);
        _market(vault, keccak256("resize-entry"), 0, true, 2, 1e6);
        uint256 mark = clearinghouse.currentPrice(0);
        vm.prank(OPERATOR);
        vault.increaseSize(keccak256("increase"), 100_000, mark, uint64(block.timestamp + 30));
        vm.prank(OPERATOR); vault.addMargin(keccak256("add-margin"), 100_000, mark, uint64(block.timestamp + 30));
        vm.prank(OPERATOR);
        vault.removeMargin(keccak256("remove-margin"), 50_000, mark, uint64(block.timestamp + 30));
        assertEq(clearinghouse.currentMargin(address(vault)), 1_150_000);
        (,,,,,uint256 size,,,,,,) = clearinghouse.position(address(vault));
        vm.prank(OPERATOR);
        vault.reduceSize(keccak256("partial-close"), size / 2, mark, uint64(block.timestamp + 30));
        assertEq(clearinghouse.currentMargin(address(vault)), 575_000);
        assertEq(clearinghouse.reserveCommitted(), 2_300_000);
        assertTrue(circle.balanceOf(address(vault)) > 0);
        uint256 freshMark = clearinghouse.currentPrice(0);
        vm.prank(OPERATOR);
        vault.closePosition(keccak256("final-close"), freshMark, uint64(block.timestamp + 30));
        assertEq(clearinghouse.currentMargin(address(vault)), 0);
        assertEq(clearinghouse.reserveCommitted(), 0);
        assertEq(clearinghouse.openPositionCount(), 0);
    }

    function testLinkedTakeProfitAndStopUseOnchainTriggers() public {
        PerpVault vault = _enroll(OWNER_KEY, 1e6, 600, 205);
        _market(vault, keccak256("trigger-entry"), 0, true, 2, 1e6);
        uint256 entry = clearinghouse.currentPrice(0);
        vm.prank(OPERATOR);
        vault.setTriggers(keccak256("set-trigger"), entry * 10_500 / 10_000, entry * 9_900 / 10_000);
        _movePriceUp(0, 5e6);
        uint256 mark = clearinghouse.currentPrice(0);
        vm.prank(OPERATOR);
        vault.executeTrigger(keccak256("tp-fired"), mark, uint64(block.timestamp + 30));
        assertEq(clearinghouse.currentMargin(address(vault)), 0);
        assertTrue(circle.balanceOf(address(vault)) > 1e6);
    }

    function testRoutineActionsRejectStaleOrOverOnePercentQuotes() public {
        PerpVault vault = _enroll(OWNER_KEY, 1e6, 600, 206);
        uint256 entry = clearinghouse.currentPrice(0);
        vm.expectRevert(PerpClearinghouseBase.StalePrice.selector);
        vm.prank(OPERATOR);
        vault.submitEntry(keccak256("stale"), 0, true, 2, 1e6, 0, entry * 102 / 100,
            uint64(block.timestamp + 30));
        vm.expectRevert(PerpClearinghouseBase.StalePrice.selector);
        vm.prank(OPERATOR);
        vault.submitEntry(keccak256("expired-quote"), 0, true, 2, 1e6, 0, entry,
            uint64(block.timestamp + 31));
        assertEq(circle.balanceOf(address(vault)), 1e6);
        assertEq(clearinghouse.userCollateralTotal(), 0);
    }

    function testRemoveMarginCannotPushEffectiveLeverageAboveTenX() public {
        PerpVault vault = _enroll(OWNER_KEY, 1e6, 600, 207);
        _market(vault, keccak256("ten-x-margin-entry"), 0, true, 10, 1e6);
        uint256 mark = clearinghouse.currentPrice(0);
        vm.expectRevert(PerpClearinghouseBase.InvalidAmount.selector);
        vm.prank(OPERATOR);
        vault.removeMargin(keccak256("over-leveraged-remove"), 100_000,
            mark, uint64(block.timestamp + 30));
        assertEq(clearinghouse.currentMargin(address(vault)), 1e6);
        assertEq(clearinghouse.reserveCommitted(), 4e6);
    }
}

