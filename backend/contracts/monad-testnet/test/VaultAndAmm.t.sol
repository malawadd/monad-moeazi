// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase, MockERC20} from "./TestBase.sol";
import {MonadTestnetRegistry} from "../src/MonadTestnetRegistry.sol";
import {MeraMandate} from "../src/MeraMandate.sol";
import {MoeaziTestnetVault} from "../src/MoeaziTestnetVault.sol";
import {MoeaziTestAmmAdapter} from "../src/MoeaziTestAmmAdapter.sol";
import {UniswapV4NoHookAdapter} from "../src/UniswapV4NoHookAdapter.sol";

contract VaultAndAmmTest is TestBase {
    uint256 private constant OWNER_KEY = 0xA11CE;
    address private owner;
    address private executor = address(0xB0B);
    address private usdc = MonadTestnetRegistry.USDC;
    address private wmon = MonadTestnetRegistry.WMON;
    MoeaziTestAmmAdapter private amm;
    UniswapV4NoHookAdapter private v4;
    MoeaziTestnetVault private vault;

    function setUp() public {
        owner = vm.addr(OWNER_KEY);
        vm.etch(usdc, type(MockERC20).runtimeCode);
        vm.etch(wmon, type(MockERC20).runtimeCode);
        MockERC20(usdc).mint(owner, 500e6);
        MockERC20(wmon).mint(owner, 500e18);
        amm = new MoeaziTestAmmAdapter(owner);
        v4 = new UniswapV4NoHookAdapter();
        address[] memory adapters = new address[](2);
        adapters[0] = address(amm);
        adapters[1] = address(v4);
        vault = new MoeaziTestnetVault(owner, executor, adapters);
        vm.prank(owner);
        MockERC20(usdc).approve(address(amm), 100e6);
        vm.prank(owner);
        MockERC20(wmon).approve(address(amm), 100e18);
        vm.prank(owner);
        amm.addLiquidity(100e6, 100e18);
    }

    function testOwnerDepositsWithdrawsAndOnlyCanonicalAssets() public {
        vm.prank(owner);
        MockERC20(usdc).approve(address(vault), 10e6);
        vm.prank(owner);
        vault.deposit(usdc, 10e6);
        assertEq(MockERC20(usdc).balanceOf(address(vault)), 10e6);
        vm.prank(owner);
        vault.withdraw(usdc, 4e6);
        assertEq(MockERC20(usdc).balanceOf(address(vault)), 6e6);
        vm.expectRevert(MoeaziTestnetVault.Unauthorized.selector);
        vm.prank(executor);
        vault.withdraw(usdc, 1e6);
        vm.expectRevert(MoeaziTestnetVault.InvalidAsset.selector);
        vm.prank(owner);
        vault.deposit(address(0x1234), 1);
    }

    function testManagedCapsReplayProtectionAndManualWalletSwapsBothDirections() public {
        vm.prank(owner);
        MockERC20(usdc).approve(address(vault), 10e6);
        vm.prank(owner);
        vault.deposit(usdc, 10e6);
        address[] memory allowed = new address[](1);
        allowed[0] = address(amm);
        assertTrue(vault.adapterAllowed(address(v4)));
        MeraMandate.Mandate memory mandate = _mandate(allowed, 5e6, 7e6, vault.mandateNonce());
        _authorize(mandate);
        assertTrue(vault.isMandateActive(vault.activeMandateHash()));
        vm.expectRevert(MoeaziTestnetVault.AdapterNotAllowed.selector);
        vm.prank(executor);
        vault.executeMandatedSwap(keccak256("v4 outside mandate"), address(v4), 1, 1, bytes(""));
        bytes32 firstOrder = keccak256("first order");
        vm.prank(executor);
        vault.executeMandatedSwap(firstOrder, address(amm), 4e6, 1, bytes(""));
        assertEq(vault.mandateUsed(mandate.nonce), 4e6);
        assertTrue(vault.executedOrder(firstOrder));
        vm.expectRevert(MoeaziTestnetVault.InvalidMandate.selector);
        vm.prank(executor);
        vault.executeMandatedSwap(firstOrder, address(amm), 1e6, 1, bytes(""));
        vm.prank(executor);
        vault.executeMandatedSwap(keccak256("second order"), address(amm), 3e6, 1, bytes(""));
        vm.expectRevert(MoeaziTestnetVault.CapExceeded.selector);
        vm.prank(executor);
        vault.executeMandatedSwap(keccak256("over cap"), address(amm), 1, 1, bytes(""));
        vm.expectRevert(MoeaziTestnetVault.Unauthorized.selector);
        vm.prank(address(0xBAD));
        vault.executeMandatedSwap(keccak256("not executor"), address(amm), 1, 1, bytes(""));

        vm.prank(owner);
        MockERC20(usdc).approve(address(amm), 2e6);
        (uint256 wmonQuote, bool wmonAvailable) = amm.quoteExactInput(usdc, wmon, 1e6, bytes(""));
        assertTrue(wmonAvailable && wmonQuote > 0);
        vm.prank(owner);
        uint256 wmonOut = amm.swap(usdc, wmon, 1e6, 1, bytes(""));
        assertTrue(wmonOut > 0);
        vm.prank(owner);
        MockERC20(wmon).approve(address(amm), 2e18);
        (uint256 usdcQuote, bool usdcAvailable) = amm.quoteExactInput(wmon, usdc, 1e18, bytes(""));
        assertTrue(usdcAvailable && usdcQuote > 0);
        vm.prank(owner);
        uint256 usdcOut = amm.swap(wmon, usdc, 1e18, 1, bytes(""));
        assertTrue(usdcOut > 0);
    }

    function testPastValidAfterIsAcceptedAndStopRevocationInvalidatesOldSignatures() public {
        address[] memory allowed = new address[](1);
        allowed[0] = address(amm);
        MeraMandate.Mandate memory stale = _mandate(allowed, 1e6, 1e6, vault.mandateNonce());
        bytes memory oldSignature = _signature(stale);
        vm.prank(owner);
        vault.revokeMandate();
        assertEq(vault.mandateNonce(), stale.nonce + 1);
        vm.expectRevert(MoeaziTestnetVault.InvalidMandate.selector);
        vault.authorizeMandate(stale, oldSignature);

        MeraMandate.Mandate memory active = _mandate(allowed, 1e6, 1e6, vault.mandateNonce());
        _authorize(active);
        assertTrue(vault.mandateActive());
        vm.prank(owner);
        vault.stop();
        assertTrue(vault.stopped());
        assertFalse(vault.mandateActive());
        vm.prank(owner);
        vault.resume();
        assertFalse(vault.stopped());
        bytes memory stoppedSignature = _signature(active);
        vm.expectRevert(MoeaziTestnetVault.InvalidMandate.selector);
        vault.authorizeMandate(active, stoppedSignature);
    }

    function testStopWithoutActiveMandateInvalidatesPendingSignature() public {
        address[] memory allowed = new address[](1);
        allowed[0] = address(amm);
        MeraMandate.Mandate memory pending = _mandate(allowed, 1e6, 1e6, vault.mandateNonce());
        bytes memory signature = _signature(pending);
        vm.prank(owner);
        vault.stop();
        vm.prank(owner);
        vault.resume();
        vm.expectRevert(MoeaziTestnetVault.InvalidMandate.selector);
        vault.authorizeMandate(pending, signature);
    }

    function _mandate(address[] memory allowed, uint256 perTrade, uint256 total, uint256 nonce)
        private view returns (MeraMandate.Mandate memory)
    {
        return MeraMandate.Mandate({
            chainId: 10143, vault: address(vault), allowedAdapters: allowed,
            tokenIn: usdc, tokenOut: wmon, maxInputPerTrade: perTrade, maxTotalInput: total,
            validAfter: uint64(block.timestamp - 1), expiresAt: uint64(block.timestamp + 1 hours), nonce: nonce
        });
    }

    function _authorize(MeraMandate.Mandate memory mandate) private {
        vm.prank(owner);
        vault.authorizeMandate(mandate, _signature(mandate));
    }

    function _signature(MeraMandate.Mandate memory mandate) private returns (bytes memory) {
        bytes32 digest = vault.mandateDigest(mandate);
        (uint8 v_, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, digest);
        return abi.encodePacked(r, s, v_);
    }
}
