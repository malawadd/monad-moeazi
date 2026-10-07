// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "../TestBase.sol";
import {PerplTestnetRegistry, IPerplOrderExchange} from "../../src/perpl/PerplTestnetRegistry.sol";
import {PerplStrategyMandate} from "../../src/perpl/PerplStrategyMandate.sol";
import {PerplStrategyVaultFactory} from "../../src/perpl/PerplStrategyVaultFactory.sol";
import {PerplStrategyVault} from "../../src/perpl/PerplStrategyVault.sol";
import {
    MockPerplAUSD,
    MockPerplStrategyExchange,
    MockPerplStrategyDelegatedAccount,
    MockPerplStrategyDelegatedAccountFactory
} from "./MockPerplStrategy.sol";

contract PerplStrategyVaultTest is TestBase {
    uint256 private constant OWNER_KEY = 0xA11CE;
    address private constant OPERATOR = address(0xB0B);
    MockPerplAUSD private ausd;
    MockPerplStrategyExchange private exchange;
    MockPerplStrategyDelegatedAccountFactory private perplFactory;
    PerplStrategyVaultFactory private factory;

    function setUp() public {
        vm.chainId(PerplTestnetRegistry.CHAIN_ID);
        vm.warp(1_700_000_000);
        MockPerplAUSD tokenImpl = new MockPerplAUSD();
        vm.etch(PerplTestnetRegistry.AUSD, address(tokenImpl).code);
        ausd = MockPerplAUSD(PerplTestnetRegistry.AUSD);
        MockPerplStrategyExchange exchangeImpl = new MockPerplStrategyExchange();
        vm.etch(PerplTestnetRegistry.EXCHANGE, address(exchangeImpl).code);
        exchange = MockPerplStrategyExchange(PerplTestnetRegistry.EXCHANGE);
        MockPerplStrategyDelegatedAccountFactory perplFactoryImpl =
            new MockPerplStrategyDelegatedAccountFactory(address(ausd), address(exchange));
        vm.etch(PerplTestnetRegistry.DELEGATED_ACCOUNT_FACTORY, address(perplFactoryImpl).code);
        perplFactory = MockPerplStrategyDelegatedAccountFactory(PerplTestnetRegistry.DELEGATED_ACCOUNT_FACTORY);
        factory = new PerplStrategyVaultFactory(address(this), OPERATOR);
    }

    function testEnrollmentGateIsOffAndFundedCounterfactualVaultIsUntouched() public {
        address owner = vm.addr(OWNER_KEY);
        PerplStrategyMandate.Mandate memory mandate = _prepare(owner, 0, 100e6);
        _fund(owner, mandate.vault, mandate.fundingAmount);
        bytes memory signature = _sign(mandate);
        vm.expectRevert(PerplStrategyVaultFactory.EnrollmentDisabled.selector);
        vm.prank(OPERATOR);
        factory.activateRun(mandate, signature, block.timestamp + 60, hex"01");
        assertEq(factory.vaultFor(owner), address(0));
        assertEq(ausd.balanceOf(mandate.vault), 100e6);
    }

    function testActivationFailureCanDeployVaultAndRecoverPrefunding() public {
        _enable();
        address owner = vm.addr(OWNER_KEY);
        PerplStrategyMandate.Mandate memory mandate = _prepare(owner, 0, 100e6);
        _fund(owner, mandate.vault, mandate.fundingAmount);
        bytes memory badSignature = _sign(mandate);
        badSignature[0] = bytes1(uint8(badSignature[0]) ^ 1);

        vm.expectRevert(PerplStrategyVaultFactory.InvalidSignature.selector);
        vm.prank(OPERATOR);
        factory.activateRun(mandate, badSignature, block.timestamp + 60, hex"01");
        assertEq(factory.vaultFor(owner), address(0));
        assertEq(ausd.balanceOf(mandate.vault), 100e6);

        address deployed = factory.createVault(owner);
        assertEq(deployed, mandate.vault);
        assertTrue(deployed.code.length != 0);
        vm.prank(owner);
        PerplStrategyVault(deployed).recoverVaultFunding();
        assertEq(ausd.balanceOf(owner), 100e6);
        assertEq(ausd.balanceOf(deployed), 0);
    }

    function testRunMandateBoundsAndSignaturesGateSetup() public {
        _enable();
        address owner = vm.addr(OWNER_KEY);
        PerplStrategyMandate.Mandate memory mandate = _prepare(owner, 0, 100e6);
        _fund(owner, mandate.vault, mandate.fundingAmount);
        mandate.maxPositionExposure = 201e6;
        bytes memory invalidPolicySignature = _sign(mandate);
        vm.expectRevert(PerplStrategyVault.InvalidRun.selector);
        vm.prank(OPERATOR);
        factory.activateRun(mandate, invalidPolicySignature, block.timestamp + 60, hex"01");
        assertEq(factory.vaultFor(owner), address(0));

        mandate = _prepare(owner, 0, 100e6);
        _fund(owner, mandate.vault, mandate.fundingAmount);
        bytes memory wrongSignature = _sign(mandate);
        wrongSignature[0] = bytes1(uint8(wrongSignature[0]) ^ 1);
        vm.expectRevert(PerplStrategyVaultFactory.InvalidSignature.selector);
        vm.prank(OPERATOR);
        factory.activateRun(mandate, wrongSignature, block.timestamp + 60, hex"01");
    }

    function testSettlementRequiresNoPositionsOrOrdersAndReturnsAUSDToOwner() public {
        _enable();
        address owner = vm.addr(OWNER_KEY);
        PerplStrategyVault vault = _activate(owner, 0, 100e6);
        MockPerplStrategyDelegatedAccount da = MockPerplStrategyDelegatedAccount(vault.delegatedAccount());
        assertEq(da.owner(), address(vault));
        assertTrue(da.isOperator(OPERATOR));
        assertFalse(da.forwardingAllowed());
        assertTrue(da.operatorAllowlist(IPerplOrderExchange.execOrder.selector));
        assertTrue(da.operatorAllowlist(IPerplOrderExchange.execOrders.selector));
        assertEq(uint256(vault.transport()), PerplStrategyMandate.TRANSPORT_DIRECT_ONCHAIN);
        vm.expectRevert(PerplStrategyVault.InvalidRun.selector);
        vm.prank(owner);
        vault.setForwardingForRecovery(true);

        vm.expectRevert(MockPerplStrategyDelegatedAccount.Unauthorized.selector);
        vm.prank(OPERATOR);
        da.withdrawCollateral(1);

        vm.prank(owner);
        vault.requestStop();
        exchange.setPositions(da.accountId(), 1, 0, 0, 0);
        vm.expectRevert(PerplStrategyVault.SettlementNotReady.selector);
        vm.prank(OPERATOR);
        vault.markSettlementReady(keccak256("uncleared position"));
        exchange.setPositions(da.accountId(), 0, 0, 0, 0);
        exchange.setPendingOrder(da.accountId(), true);
        vm.expectRevert(PerplStrategyVault.SettlementNotReady.selector);
        vm.prank(OPERATOR);
        vault.markSettlementReady(keccak256("uncleared order"));
        exchange.setPendingOrder(da.accountId(), false);

        vm.prank(OPERATOR);
        vault.markSettlementReady(keccak256("direct chain reconciliation"));
        vm.expectRevert(PerplStrategyVault.SettlementNotReady.selector);
        vm.prank(OPERATOR);
        vault.completeSettlement(0);
        vm.prank(OPERATOR);
        vault.completeSettlement(100e6);

        assertEq(ausd.balanceOf(owner), 100e6);
        assertEq(uint256(vault.runStatus()), uint256(PerplStrategyVault.RunStatus.Settled));
        assertFalse(da.isOperator(OPERATOR));
        assertFalse(da.forwardingAllowed());
    }

    function testReusableVaultReusesPerplAccountAndReauthorizesOperator() public {
        _enable();
        address owner = vm.addr(OWNER_KEY);
        PerplStrategyVault first = _activate(owner, 0, 100e6);
        address da = first.delegatedAccount();
        vm.prank(owner);
        first.requestStop();
        vm.prank(OPERATOR);
        first.markSettlementReady(keccak256("first settled"));
        vm.prank(OPERATOR);
        first.completeSettlement(100e6);

        ausd.mint(owner, 105e6);
        _fund(owner, address(first), 105e6);
        PerplStrategyMandate.Mandate memory next = _prepare(owner, 1, 105e6);
        next.transport = PerplStrategyMandate.TRANSPORT_API_FORWARDING;
        bytes memory ownerSignature = _sign(next);
        vm.prank(OPERATOR);
        address reused = factory.activateRun(next, ownerSignature, block.timestamp + 60, hex"02");
        assertEq(reused, address(first));
        assertEq(first.delegatedAccount(), da);
        assertEq(perplFactory.createCount(), 1);
        assertTrue(MockPerplStrategyDelegatedAccount(da).isOperator(OPERATOR));
        assertFalse(MockPerplStrategyDelegatedAccount(da).operatorAllowlist(IPerplOrderExchange.execOrder.selector));
        assertTrue(MockPerplStrategyDelegatedAccount(da).forwardingAllowed());
        assertEq(ausd.balanceOf(address(first)), 0);
        assertEq(first.runNonce(), 2);
    }

    function testExpiredRunCanBeSettledWithoutOwnerSignature() public {
        _enable();
        address owner = vm.addr(OWNER_KEY);
        PerplStrategyVault vault = _activate(owner, 0, 100e6);
        vm.warp(vault.expiresAt());
        vm.prank(OPERATOR);
        vault.markSettlementReady(keccak256("expired and flat"));
        vm.prank(OPERATOR);
        vault.completeSettlement(100e6);
        assertEq(ausd.balanceOf(owner), 100e6);
    }

    function testOwnerRecoveryDisablesForwardingAndRevokesOperatorAtomically() public {
        _enable();
        address owner = vm.addr(OWNER_KEY);
        PerplStrategyVault vault = _activate(owner, 0, 100e6);
        MockPerplStrategyDelegatedAccount da = MockPerplStrategyDelegatedAccount(vault.delegatedAccount());
        vm.prank(owner);
        vault.requestStop();

        exchange.setPendingOrder(da.accountId(), true);
        vm.expectRevert(PerplStrategyVault.SettlementNotReady.selector);
        vm.prank(owner);
        vault.recoverWithdrawCollateral(100e6);
        assertFalse(da.forwardingAllowed());
        assertTrue(da.isOperator(OPERATOR));

        exchange.setPendingOrder(da.accountId(), false);
        vm.prank(owner);
        vault.recoverWithdrawCollateral(100e6);
        assertFalse(da.forwardingAllowed());
        assertFalse(da.isOperator(OPERATOR));
        assertEq(ausd.balanceOf(owner), 100e6);
        assertEq(uint256(vault.runStatus()), uint256(PerplStrategyVault.RunStatus.StopRequested));
    }

    function testOwnerCanDisableForwardingWithoutWithdrawingPerplBalance() public {
        _enable();
        address owner = vm.addr(OWNER_KEY);
        PerplStrategyVault vault = _activate(owner, 0, 100e6);
        MockPerplStrategyDelegatedAccount da = MockPerplStrategyDelegatedAccount(vault.delegatedAccount());
        vm.prank(owner);
        vault.requestStop();

        vm.prank(owner);
        vault.recoverWithdrawCollateral(0);

        assertFalse(da.forwardingAllowed());
        assertFalse(da.isOperator(OPERATOR));
        assertEq(ausd.balanceOf(owner), 0);
        assertEq(exchange.getAccountById(da.accountId()).balanceCNS, 100e6);
    }

    function testApiTransportIsSignedAndKeepsForwardingEnabled() public {
        _enable();
        address owner = vm.addr(OWNER_KEY);
        PerplStrategyMandate.Mandate memory mandate = _prepare(owner, 0, 100e6);
        mandate.transport = PerplStrategyMandate.TRANSPORT_API_FORWARDING;
        _fund(owner, mandate.vault, mandate.fundingAmount);
        bytes memory ownerSignature = _sign(mandate);
        vm.prank(OPERATOR);
        address deployed = factory.activateRun(mandate, ownerSignature, block.timestamp + 60, hex"01");
        PerplStrategyVault vault = PerplStrategyVault(deployed);
        assertEq(uint256(vault.transport()), PerplStrategyMandate.TRANSPORT_API_FORWARDING);
        MockPerplStrategyDelegatedAccount da = MockPerplStrategyDelegatedAccount(vault.delegatedAccount());
        assertTrue(da.forwardingAllowed());
        assertFalse(da.operatorAllowlist(IPerplOrderExchange.execOrder.selector));
        assertFalse(da.operatorAllowlist(IPerplOrderExchange.execOrders.selector));
    }

    function _enable() private {
        factory.setEnrollmentEnabled(true);
    }

    function _activate(address owner, uint256 nonce, uint256 amount) private returns (PerplStrategyVault vault) {
        PerplStrategyMandate.Mandate memory mandate = _prepare(owner, nonce, amount);
        _fund(owner, mandate.vault, amount);
        bytes memory ownerSignature = _sign(mandate);
        vm.prank(OPERATOR);
        address deployed = factory.activateRun(mandate, ownerSignature, block.timestamp + 60, hex"01");
        return PerplStrategyVault(deployed);
    }

    function _prepare(address owner, uint256 nonce, uint256 amount)
        private
        view
        returns (PerplStrategyMandate.Mandate memory mandate)
    {
        mandate.chainId = PerplTestnetRegistry.CHAIN_ID;
        mandate.owner = owner;
        mandate.vault = factory.predictVault(owner);
        mandate.collateralToken = PerplTestnetRegistry.AUSD;
        mandate.operator = OPERATOR;
        mandate.transport = PerplStrategyMandate.TRANSPORT_DIRECT_ONCHAIN;
        mandate.fundingAmount = amount;
        mandate.maxPositionExposure = amount * 2;
        mandate.maxLeverage = 2;
        mandate.durationSeconds = 600;
        mandate.setupDeadline = uint64(block.timestamp + 300);
        mandate.policyVersion = 2;
        mandate.nonce = nonce;
        mandate.marketIds = new uint256[](2);
        mandate.marketIds[0] = 16;
        mandate.marketIds[1] = 32;
    }

    function _sign(PerplStrategyMandate.Mandate memory mandate) private returns (bytes memory signature) {
        bytes32 digest = factory.mandateDigest(mandate);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _fund(address owner, address target, uint256 amount) private {
        ausd.mint(owner, amount);
        vm.prank(owner);
        ausd.transfer(target, amount);
    }
}
