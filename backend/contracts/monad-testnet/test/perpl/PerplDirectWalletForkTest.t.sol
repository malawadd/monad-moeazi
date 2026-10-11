// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase, VmTest} from "../TestBase.sol";
import {PerplTestnetRegistry, IPerplOrderExchange, IPerplSettlementExchange}
    from "../../src/perpl/PerplTestnetRegistry.sol";

interface VmDirectWalletFork is VmTest {
    function createSelectFork(string calldata rpcUrl) external returns (uint256 forkId);
    function envOr(string calldata name, string calldata defaultValue) external returns (string memory value);
    function expectRevert() external;
}

interface IPerplDirectExchange is IPerplOrderExchange, IPerplSettlementExchange {
    struct PerpetualInfo {
        string name; string symbol; uint256 priceDecimals; uint256 lotDecimals; bytes32 linkFeedId;
        uint256 priceTolPer100K; uint256 marginTol; uint256 marginTolDecimals; uint256 refPriceMaxAgeSec;
        uint256 positionBalanceCNS; uint256 insuranceBalanceCNS; uint256 markPNS; uint256 markTimestamp;
        uint256 lastPNS; uint256 lastTimestamp; uint256 oraclePNS; uint256 oracleTimestampSec;
        uint256 longOpenInterestLNS; uint256 shortOpenInterestLNS; uint256 fundingStartBlock;
        int16 fundingRatePct100k; uint256 absFundingClampPctPer100K; uint8 status; uint256 basePricePNS;
        uint256 maxBidPriceONS; uint256 minBidPriceONS; uint256 maxAskPriceONS; uint256 minAskPriceONS;
        uint256 numOrders; bool ignOracle;
    }
    struct PositionInfo {
        uint256 accountId; uint256 nextNodeId; uint256 prevNodeId; uint8 positionType; uint256 depositCNS;
        uint256 pricePNS; uint256 lotLNS; uint256 entryBlock; int256 pnlCNS; int256 deltaPnlCNS;
        int256 premiumPnlCNS; uint256 priceResiduePNSQ16;
    }
    function getAccountByAddr(address account) external view returns (uint256 accountId);
    function createAccount(uint256 amountCNS) external returns (uint256 accountId);
    function depositCollateral(uint256 amountCNS) external;
    function withdrawCollateral(uint256 amountCNS) external;
    function getPerpetualInfo(uint256 perpId) external view returns (PerpetualInfo memory);
    function getPositionV2(uint256 perpId, uint256 accountId)
        external view returns (PositionInfo memory positionInfo, uint256 markPricePNS, bool markPriceValid);
    function owner() external view returns (address);
    function setIgnOracle(uint256 perpId, bool ignored) external;
}

interface IPerplDirectToken {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}

interface IPerplDirectFaucet { function requestFunds(address recipient) external; }

/// @notice Mera EOA account lifecycle on a local Monad Testnet fork; no fork mutation is broadcast.
contract PerplDirectWalletForkTest is TestBase {
    uint256 private constant OWNER_KEY = 0xD1EC7;
    uint256 private constant FUNDER_KEY = 0xF00D;
    uint256 private constant OTHER_KEY = 0xA11CE;
    uint256 private constant BTC_PERP_ID = 16;
    // Live /v1/pub/context currently reports 100_000_000 (100 AUSD) for this instance.
    uint256 private constant LIVE_ACCOUNT_OPEN_MIN = 100_000_000;
    uint256 private constant LIVE_DEPOSIT_MIN = 10_000_000;
    uint256 private constant LIVE_WITHDRAW_MIN = 10_000;
    address private constant AUSD_FAUCET = 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C;
    VmDirectWalletFork private constant forkVm =
        VmDirectWalletFork(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testMeraEoaApprovesCreatesDepositsTradesClosesAndWithdraws() external {
        _selectFork();
        address owner = vm.addr(OWNER_KEY);
        address funder = vm.addr(FUNDER_KEY);
        address other = vm.addr(OTHER_KEY);
        _assertCollateralConfiguration();
        _fund(owner, funder);
        uint256 accountId = _createAccount(owner, other);
        _deposit(owner, accountId);
        _tradeAndClose(owner, accountId);
        _withdraw(owner, other, accountId);
    }

    function _assertCollateralConfiguration() private view {
        IPerplDirectToken token = IPerplDirectToken(PerplTestnetRegistry.AUSD);
        IPerplDirectExchange exchange = IPerplDirectExchange(PerplTestnetRegistry.EXCHANGE);
        assertEq(block.chainid, PerplTestnetRegistry.CHAIN_ID);
        assertEq(uint256(token.decimals()), PerplTestnetRegistry.AUSD_DECIMALS);
        assertEq(LIVE_ACCOUNT_OPEN_MIN, PerplTestnetRegistry.MIN_ACCOUNT_CREATION_AUSD);
        (,,, uint256 collateralDecimals, address collateralToken,) = exchange.getExchangeInfo();
        assertEq(collateralDecimals, PerplTestnetRegistry.AUSD_DECIMALS);
        assertEq(collateralToken, PerplTestnetRegistry.AUSD);
    }

    function _fund(address owner, address funder) private {
        IPerplDirectToken token = IPerplDirectToken(PerplTestnetRegistry.AUSD);
        uint256 forkTimestamp = block.timestamp;
        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        IPerplDirectFaucet(AUSD_FAUCET).requestFunds(owner);
        vm.warp(block.timestamp + 1 days);
        vm.prank(funder);
        IPerplDirectFaucet(AUSD_FAUCET).requestFunds(funder);
        vm.warp(forkTimestamp);
        assertTrue(token.balanceOf(owner) >= LIVE_ACCOUNT_OPEN_MIN);
        assertTrue(token.balanceOf(funder) >= LIVE_DEPOSIT_MIN);
        vm.prank(funder);
        assertTrue(token.transfer(owner, LIVE_DEPOSIT_MIN));
    }

    function _createAccount(address owner, address other) private returns (uint256 accountId) {
        IPerplDirectToken token = IPerplDirectToken(PerplTestnetRegistry.AUSD);
        IPerplDirectExchange exchange = IPerplDirectExchange(PerplTestnetRegistry.EXCHANGE);
        forkVm.expectRevert();
        exchange.getAccountByAddr(owner);

        uint256 beforeCreate = token.balanceOf(owner);
        vm.prank(owner);
        assertTrue(token.approve(address(exchange), LIVE_ACCOUNT_OPEN_MIN));
        vm.prank(owner);
        accountId = exchange.createAccount(LIVE_ACCOUNT_OPEN_MIN);
        assertTrue(accountId != 0);
        assertEq(exchange.getAccountByAddr(owner), accountId);
        forkVm.expectRevert();
        exchange.getAccountByAddr(other);

        IPerplSettlementExchange.AccountInfo memory account = exchange.getAccountById(accountId);
        assertEq(account.accountAddr, owner);
        assertEq(account.accountId, accountId);
        assertEq(account.balanceCNS, LIVE_ACCOUNT_OPEN_MIN);
        assertEq(token.balanceOf(owner), beforeCreate - LIVE_ACCOUNT_OPEN_MIN);
    }

    function _deposit(address owner, uint256 accountId) private {
        IPerplDirectToken token = IPerplDirectToken(PerplTestnetRegistry.AUSD);
        IPerplDirectExchange exchange = IPerplDirectExchange(PerplTestnetRegistry.EXCHANGE);
        vm.prank(owner);
        assertTrue(token.approve(address(exchange), LIVE_DEPOSIT_MIN));
        vm.prank(owner);
        exchange.depositCollateral(LIVE_DEPOSIT_MIN);
        IPerplSettlementExchange.AccountInfo memory account = exchange.getAccountById(accountId);
        assertEq(account.balanceCNS, LIVE_ACCOUNT_OPEN_MIN + LIVE_DEPOSIT_MIN);
    }

    function _tradeAndClose(address owner, uint256 accountId) private {
        IPerplDirectExchange exchange = IPerplDirectExchange(PerplTestnetRegistry.EXCHANGE);
        IPerplDirectExchange.PerpetualInfo memory perp = exchange.getPerpetualInfo(BTC_PERP_ID);
        uint256 ask = perp.basePricePNS + perp.minAskPriceONS;
        uint256 bid = perp.basePricePNS + perp.maxBidPriceONS;
        assertTrue(perp.numOrders > 0 && ask > 0 && bid > 0);
        vm.prank(exchange.owner());
        exchange.setIgnOracle(BTC_PERP_ID, true);

        vm.prank(owner);
        exchange.execOrder(_ioc(91_101, 0, ask * 11_000 / 10_000, 100));
        (IPerplDirectExchange.PositionInfo memory position,,) = exchange.getPositionV2(BTC_PERP_ID, accountId);
        assertEq(position.accountId, accountId);
        assertEq(position.lotLNS, 100);

        vm.prank(owner);
        exchange.execOrder(_ioc(91_102, 2, bid * 9_000 / 10_000, position.lotLNS));
        (position,,) = exchange.getPositionV2(BTC_PERP_ID, accountId);
        assertEq(position.lotLNS, 0);
    }

    function _withdraw(address owner, address other, uint256 accountId) private {
        IPerplDirectToken token = IPerplDirectToken(PerplTestnetRegistry.AUSD);
        IPerplDirectExchange exchange = IPerplDirectExchange(PerplTestnetRegistry.EXCHANGE);
        IPerplSettlementExchange.AccountInfo memory account = exchange.getAccountById(accountId);
        assertEq(account.accountAddr, owner);
        assertTrue(account.balanceCNS >= LIVE_WITHDRAW_MIN);
        uint256 withdrawal = LIVE_DEPOSIT_MIN;
        uint256 walletBeforeWithdraw = token.balanceOf(owner);
        uint256 exchangeBeforeWithdraw = account.balanceCNS;
        vm.prank(other);
        forkVm.expectRevert();
        exchange.withdrawCollateral(1);
        vm.prank(owner);
        exchange.withdrawCollateral(withdrawal);
        account = exchange.getAccountById(accountId);
        assertEq(account.balanceCNS, exchangeBeforeWithdraw - withdrawal);
        assertEq(token.balanceOf(owner), walletBeforeWithdraw + withdrawal);
    }

    function _selectFork() private {
        string memory rpc = forkVm.envOr("MONAD_TESTNET_RPC_URL", "https://testnet-rpc.monad.xyz");
        forkVm.createSelectFork(rpc);
        assertEq(block.chainid, PerplTestnetRegistry.CHAIN_ID);
    }

    function _ioc(uint256 id, uint8 kind, uint256 price, uint256 lot)
        private pure returns (IPerplOrderExchange.OrderDesc memory desc)
    {
        desc = IPerplOrderExchange.OrderDesc(id, BTC_PERP_ID, kind, 0, price, lot, 0, false, false, true,
            0, 100, 0, 0, 1000);
    }
}
