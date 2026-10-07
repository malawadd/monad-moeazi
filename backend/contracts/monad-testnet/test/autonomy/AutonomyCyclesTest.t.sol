// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AutonomyTestBase} from "./AutonomyTestBase.sol";
import {AutonomyTypes} from "../../src/autonomy/AutonomyTypes.sol";
import {AutonomyMandate} from "../../src/autonomy/AutonomyMandate.sol";
import {AutonomousVaultFactory} from "../../src/autonomy/AutonomousVaultFactory.sol";
import {MoeaziAutonomousVault} from "../../src/autonomy/MoeaziAutonomousVault.sol";
import {MoeaziTestPairPool} from "../../src/autonomy/MoeaziTestPairPool.sol";
import {AutonomousVaultBase} from "../../src/autonomy/AutonomousVaultBase.sol";
import {FixedSupplyMockToken} from "../../src/autonomy/FixedSupplyMockToken.sol";

interface IScenarioToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract ToggleQuotePool {
    address public immutable owner;
    address public immutable usdc;
    address public immutable token;
    bool public sellsAvailable = true;

    constructor(address owner_, address usdc_, address token_) {
        owner = owner_;
        usdc = usdc_;
        token = token_;
    }

    function seedToken(uint256 amount) external {
        require(msg.sender == owner && IScenarioToken(token).transferFrom(msg.sender, address(this), amount));
    }

    function setSellsAvailable(bool available) external {
        require(msg.sender == owner);
        sellsAvailable = available;
    }

    function quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn)
        external view returns (uint256 amountOut, bool available)
    {
        if (tokenIn == usdc && tokenOut == token && amountIn != 0) return (amountIn * 1e12, true);
        if (tokenIn == token && tokenOut == usdc && sellsAvailable && amountIn >= 1e12) {
            return (amountIn / 1e12, true);
        }
        return (0, false);
    }

    function quoteSpotExactInput(address tokenIn, address tokenOut, uint256 amountIn)
        external view returns (uint256 amountOut, bool available)
    {
        if (tokenIn == usdc && tokenOut == token && amountIn != 0) return (amountIn * 1e12, true);
        if (tokenIn == token && tokenOut == usdc && sellsAvailable && amountIn >= 1e12) {
            return (amountIn / 1e12, true);
        }
        return (0, false);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external returns (uint256 amountOut)
    {
        bool available;
        (amountOut, available) = this.quoteExactInput(tokenIn, tokenOut, amountIn);
        require(available && amountOut >= minAmountOut);
        require(IScenarioToken(tokenIn).transferFrom(msg.sender, address(this), amountIn));
        require(IScenarioToken(tokenOut).transfer(msg.sender, amountOut));
    }
}

contract AutonomyCyclesTest is AutonomyTestBase {
    function testOwnerCannotWithdrawPoolReserves() public {
        MoeaziTestPairPool pool = MoeaziTestPairPool(pools[0]);
        uint112 reserveUsdc = pool.reserveUsdc();
        uint112 reserveToken = pool.reserveToken();
        vm.prank(OPERATOR);
        (bool removed,) = address(pool).call(abi.encodeWithSignature(
            "removeLiquidity(uint256,uint256)", reserveUsdc, reserveToken
        ));
        vm.prank(OPERATOR);
        (bool withdrew,) = address(pool).call(abi.encodeWithSignature(
            "withdraw(address,uint256)", USDC, reserveUsdc
        ));
        assertFalse(removed);
        assertFalse(withdrew);
        assertEq(pool.reserveUsdc(), reserveUsdc);
        assertEq(pool.reserveToken(), reserveToken);
        assertEq(circle.balanceOf(address(pool)), reserveUsdc);
        assertEq(FixedSupplyMockToken(tokens[0]).balanceOf(address(pool)), reserveToken);
    }

    function testOnlyTheThreeApprovedTokenAndPoolIndicesAreAvailable() public {
        (MoeaziAutonomousVault vault,,,) = _enroll(OWNER_KEY, 1e6, 600, 500, 500, 50);
        vm.expectRevert(AutonomousVaultBase.InvalidAmount.selector);
        vm.prank(OPERATOR);
        vault.buy(keccak256("unknown venue"), 3, 1, 1);
        assertFalse(vault.positionOpen());
    }

    function testThreeSequentialCyclesAndOneOpenPositionLimit() public {
        (MoeaziAutonomousVault vault,,,) = _enroll(OWNER_KEY, 3e6, 600, 500, 500, 51);
        bytes32 firstBuy = keccak256("first buy");
        for (uint8 i; i < 3; ++i) {
            uint256 amountIn = 1e6;
            uint256 expectedBuy = _quote(pools[0], USDC, tokens[0], amountIn);
            bytes32 buyId = i == 0 ? firstBuy : keccak256(abi.encode("buy", i));
            vm.prank(OPERATOR);
            vault.buy(buyId, 0, amountIn, expectedBuy);
            assertTrue(vault.positionOpen());
            if (i == 0) {
                uint256 badExpected = _quote(pools[0], USDC, tokens[0], 1);
                vm.expectRevert(AutonomousVaultBase.PositionAlreadyOpen.selector);
                vm.prank(OPERATOR);
                vault.buy(keccak256("second open position"), 1, 1, badExpected);
            }
            uint256 sellExpected = _quote(pools[0], tokens[0], USDC, vault.positionAmount());
            vm.prank(OPERATOR);
            vault.sell(keccak256(abi.encode("sell", i)), sellExpected);
            assertEq(vault.completedCycles(), uint256(i + 1));
            assertFalse(vault.positionOpen());
            if (i == 0) {
                uint256 replayExpected = _quote(pools[0], USDC, tokens[0], 1);
                vm.expectRevert(AutonomousVaultBase.InvalidOrder.selector);
                vm.prank(OPERATOR);
                vault.buy(firstBuy, 0, 1, replayExpected);
            }
        }
        assertEq(uint256(vault.settlementStatus()), uint256(AutonomousVaultBase.SettlementStatus.Completed));
        assertEq(circle.balanceOf(address(vault)), 0);
        assertEq(FixedSupplyMockToken(tokens[0]).balanceOf(address(vault)), 0);
        vm.expectRevert(AutonomousVaultBase.MandateInactive.selector);
        vm.prank(OPERATOR);
        vault.buy(keccak256("fourth buy"), 0, 1, 1);
    }

    function testExpiryBlocksBuysButAllowsFinalSaleAndSettlement() public {
        (MoeaziAutonomousVault vault,,,) = _enroll(OWNER_KEY, 1e6, 600, 500, 500, 61);
        uint256 buyQuote = _quote(pools[1], USDC, tokens[1], 1e6);
        vm.prank(OPERATOR);
        vault.buy(keccak256("expiry buy"), 1, 1e6, buyQuote);
        vm.warp(vault.expiresAt());
        vm.expectRevert(AutonomousVaultBase.MandateInactive.selector);
        vm.prank(OPERATOR);
        vault.buy(keccak256("late buy"), 1, 1, 1);
        uint256 sellQuote = _quote(pools[1], tokens[1], USDC, vault.positionAmount());
        vm.prank(OPERATOR);
        vault.sell(keccak256("expiry sell"), sellQuote);
        assertEq(uint256(vault.settlementStatus()), uint256(AutonomousVaultBase.SettlementStatus.Completed));
        assertFalse(vault.positionOpen());
        assertEq(circle.balanceOf(address(vault)), 0);
    }

    function testEachBuyIsCappedAtOriginalFundingAmount() public {
        (MoeaziAutonomousVault vault,,,) = _enroll(OWNER_KEY, 1e6, 600, 500, 500, 66);
        uint256 quote = _quote(pools[0], USDC, tokens[0], 1_000_001);
        vm.expectRevert(AutonomousVaultBase.InvalidAmount.selector);
        vm.prank(OPERATOR);
        vault.buy(keccak256("over original cap"), 0, 1_000_001, quote);
        assertFalse(vault.positionOpen());
    }

    function testStaleOrZeroExpiryQuoteMustRetryInsteadOfReturningInKind() public {
        (MoeaziAutonomousVault vault,,,) = _enroll(OWNER_KEY, 1e6, 600, 100, 100, 71);
        uint256 buyQuote = _quote(pools[2], USDC, tokens[2], 1e6);
        vm.prank(OPERATOR);
        vault.buy(keccak256("stale expiry buy"), 2, 1e6, buyQuote);
        vm.warp(vault.expiresAt());
        bytes32 sellId = keccak256("fresh expiry sell");
        vm.expectRevert(AutonomousVaultBase.StaleQuote.selector);
        vm.prank(OPERATOR);
        vault.settleExpired(sellId, 0);
        assertTrue(vault.positionOpen());
        assertEq(uint256(vault.settlementStatus()), uint256(AutonomousVaultBase.SettlementStatus.Active));
        uint256 freshQuote = _quote(pools[2], tokens[2], USDC, vault.positionAmount());
        vm.prank(OPERATOR);
        vault.settleExpired(sellId, freshQuote);
        assertEq(uint256(vault.settlementStatus()), uint256(AutonomousVaultBase.SettlementStatus.Completed));
    }

    function testUnavailableSaleQuoteAtExpiryReturnsUnsoldTokenAndUsdcIncomplete() public {
        ToggleQuotePool failingPool = new ToggleQuotePool(OPERATOR, USDC, tokens[0]);
        vm.prank(OPERATOR);
        FixedSupplyMockToken(tokens[0]).approve(address(failingPool), 1e18);
        vm.prank(OPERATOR);
        failingPool.seedToken(1e18);
        address[3] memory testPools = pools;
        testPools[0] = address(failingPool);
        AutonomousVaultFactory testFactory = new AutonomousVaultFactory(
            OPERATOR, OPERATOR, USDC, tokens, testPools
        );
        vm.prank(OPERATOR);
        testFactory.setEnrollmentEnabled(true);
        PrepareOptions memory options = PrepareOptions(OWNER_KEY, 2e6, 600, 500, 500, 81);
        (AutonomyTypes.CircleAuthorization memory auth, AutonomyMandate.StrategyMandate memory mandate,
            bytes memory signature) = _prepareForFactory(testFactory, testPools, options);
        MoeaziAutonomousVault vault = MoeaziAutonomousVault(
            testFactory.createAndEnroll(auth, mandate, signature)
        );
        uint256 buyQuote = 1e18;
        vm.prank(OPERATOR);
        vault.buy(keccak256("liquidity buy"), 0, 1e6, buyQuote);
        uint256 position = vault.positionAmount();
        uint256 ownerTokenBefore = FixedSupplyMockToken(tokens[0]).balanceOf(vm.addr(OWNER_KEY));
        vm.prank(OPERATOR);
        failingPool.setSellsAvailable(false);
        vm.warp(vault.expiresAt());
        vm.prank(OPERATOR);
        vault.settleExpired(keccak256("unavailable quote sale"), 0);
        assertEq(uint256(vault.settlementStatus()), uint256(AutonomousVaultBase.SettlementStatus.Incomplete));
        assertFalse(vault.positionOpen());
        assertEq(FixedSupplyMockToken(tokens[0]).balanceOf(vm.addr(OWNER_KEY)), ownerTokenBefore + position);
        assertEq(circle.balanceOf(address(vault)), 0);
        assertEq(circle.balanceOf(vm.addr(OWNER_KEY)), 1e6);
    }

    function testExecutorCannotWeakenSignedSlippageAndStaleQuotesRevert() public {
        (MoeaziAutonomousVault vault,,,) = _enroll(OWNER_KEY, 2e6, 600, 100, 100, 91);
        uint256 oldQuote = _quote(pools[0], USDC, tokens[0], 1e6);
        vm.expectRevert(AutonomousVaultBase.StaleQuote.selector);
        vm.prank(OPERATOR);
        vault.buy(keccak256("too small expected"), 0, 1e6, 1);

        vm.prank(OPERATOR);
        circle.approve(pools[0], 5e6);
        vm.prank(OPERATOR);
        MoeaziTestPairPool(pools[0]).swap(USDC, tokens[0], 5e6, 1);
        vm.expectRevert(AutonomousVaultBase.StaleQuote.selector);
        vm.prank(OPERATOR);
        vault.buy(keccak256("stale expected"), 0, 1e6, oldQuote);
        uint256 freshQuote = _quote(pools[0], USDC, tokens[0], 1e6);
        vm.prank(OPERATOR);
        vault.buy(keccak256("fresh expected"), 0, 1e6, freshQuote);
        assertTrue(vault.positionOpen());
    }

    function testEmergencyRecoveryCanOnlyRelabelAnActiveRun() public {
        (MoeaziAutonomousVault vault,,,) = _enroll(OWNER_KEY, 3e6, 600, 500, 500, 101);
        for (uint8 i; i < 3; ++i) {
            uint256 buyQuote = _quote(pools[0], USDC, tokens[0], 1e6);
            vm.prank(OPERATOR);
            vault.buy(keccak256(abi.encode("final buy", i)), 0, 1e6, buyQuote);
            uint256 sellQuote = _quote(pools[0], tokens[0], USDC, vault.positionAmount());
            vm.prank(OPERATOR);
            vault.sell(keccak256(abi.encode("final sell", i)), sellQuote);
        }
        assertEq(uint256(vault.settlementStatus()), uint256(AutonomousVaultBase.SettlementStatus.Completed));
        vm.expectRevert(AutonomousVaultBase.MandateInactive.selector);
        vm.prank(vm.addr(OWNER_KEY));
        vault.emergencyRecover();
    }

}
