// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase, VmTest} from "../TestBase.sol";
import {PerplTestnetRegistry, IPerplOrderExchange, IPerplSettlementExchange}
    from "../../src/perpl/PerplTestnetRegistry.sol";
import {PerplStrategyMandate} from "../../src/perpl/PerplStrategyMandate.sol";
import {PerplStrategyVaultFactory} from "../../src/perpl/PerplStrategyVaultFactory.sol";

interface VmPerplOrderFork is VmTest {
    struct Log { bytes32[] topics; bytes data; address emitter; }
    function createSelectFork(string calldata rpcUrl) external returns (uint256 forkId);
    function envOr(string calldata name, string calldata defaultValue) external returns (string memory value);
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

interface IPerplTestnetFactory {
    function operatorNonces(address operator) external view returns (uint256);
    function create(address operator, uint256 deadline, bytes calldata operatorSignature) external returns (address);
}

interface IPerplTestnetVaultFactory {
    function setEnrollmentEnabled(bool enabled) external;
    function mandateNonce(address owner) external view returns (uint256);
    function predictVault(address owner) external view returns (address);
    function mandateDigest(PerplStrategyMandate.Mandate calldata mandate) external view returns (bytes32);
    function activateRun(PerplStrategyMandate.Mandate calldata mandate, bytes calldata ownerSignature,
        uint256 operatorDeadline, bytes calldata operatorSignature) external returns (address);
    function delegatedAccount(address owner) external view returns (address);
}

interface IPerplTestnetAccount {
    function accountId() external view returns (uint256);
    function operatorAllowlist(bytes4 selector) external view returns (bool);
}

interface IPerplOrderStateExchange is IPerplOrderExchange {
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
    function getPerpetualInfo(uint256 perpId) external view returns (PerpetualInfo memory);
    function getPositionV2(uint256 perpId, uint256 accountId)
        external view returns (PositionInfo memory positionInfo, uint256 markPricePNS, bool markPriceValid);
    function owner() external view returns (address);
    function setIgnOracle(uint256 perpId, bool ignored) external;
}

interface IPerplOrderFaucet { function requestFunds(address recipient) external; }
interface IPerplOrderToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Executes only against a local fork; all Testnet state mutations are discarded by Foundry.
contract PerplDirectExecutionForkTest is TestBase {
    uint256 private constant OWNER_KEY = 0xA11CE;
    uint256 private constant OPERATOR_KEY = 0x0B0B;
    uint256 private constant BTC_PERP_ID = 16;
    uint256 private constant FUNDING = 100_000_000;
    address private constant AUSD_FAUCET = 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C;
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("DelegatedAccountFactory");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant ASSIGN_OPERATOR_TYPEHASH =
        keccak256("AssignOperator(address owner,uint256 nonce,uint256 deadline)");
    VmPerplOrderFork private constant forkVm =
        VmPerplOrderFork(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Run { address owner; address operator; address vault; address da; uint256 accountId; }

    function testDirectIocEntryCloseCancelAndFillEventsOnMonadFork() external {
        _selectFork();
        Run memory run = _activateDirectRun();
        IPerplOrderStateExchange exchange = IPerplOrderStateExchange(PerplTestnetRegistry.EXCHANGE);
        IPerplOrderStateExchange.PerpetualInfo memory perp = exchange.getPerpetualInfo(BTC_PERP_ID);
        uint256 ask = perp.basePricePNS + perp.minAskPriceONS;
        uint256 bid = perp.basePricePNS + perp.maxBidPriceONS;
        assertTrue(ask > 0 && bid > 0 && perp.numOrders > 0);

        IPerplOrderExchange.OrderDesc memory entry = _ioc(41, 0, ask * 11_000 / 10_000, 100);
        forkVm.recordLogs();
        vm.prank(run.operator);
        IPerplOrderExchange(run.da).execOrder(entry);
        VmPerplOrderFork.Log[] memory entryLogs = forkVm.getRecordedLogs();
        assertTrue(_hasTakerFill(entryLogs));
        assertTrue(_hasOrderRequest(entryLogs, 41, 0));
        IPerplOrderStateExchange.PositionInfo memory position = _position(exchange, run.accountId);
        assertEq(position.lotLNS, 100);

        IPerplOrderExchange.OrderDesc memory close = _ioc(42, 2, bid * 9_000 / 10_000, position.lotLNS);
        forkVm.recordLogs();
        vm.prank(run.operator);
        IPerplOrderExchange(run.da).execOrder(close);
        VmPerplOrderFork.Log[] memory closeLogs = forkVm.getRecordedLogs();
        assertTrue(_hasTakerFill(closeLogs));
        assertTrue(_hasOrderRequest(closeLogs, 42, 2));
        position = _position(exchange, run.accountId);
        assertEq(position.lotLNS, 0);

        _exerciseShortLifecycle(run, exchange, ask, bid);
        _exerciseCancel(run, bid);
    }

    function _exerciseShortLifecycle(
        Run memory run, IPerplOrderStateExchange exchange, uint256 ask, uint256 bid
    ) private {
        IPerplOrderExchange.OrderDesc memory shortEntry = _ioc(77, 1, bid * 9_000 / 10_000, 100);
        forkVm.recordLogs();
        vm.prank(run.operator);
        IPerplOrderExchange(run.da).execOrder(shortEntry);
        VmPerplOrderFork.Log[] memory shortEntryLogs = forkVm.getRecordedLogs();
        assertTrue(_hasTakerFill(shortEntryLogs));
        assertTrue(_hasOrderRequest(shortEntryLogs, 77, 1));
        IPerplOrderStateExchange.PositionInfo memory position = _position(exchange, run.accountId);
        assertEq(position.lotLNS, 100);

        IPerplOrderExchange.OrderDesc memory shortClose =
            _ioc(78, 3, ask * 11_000 / 10_000, position.lotLNS);
        forkVm.recordLogs();
        vm.prank(run.operator);
        IPerplOrderExchange(run.da).execOrder(shortClose);
        VmPerplOrderFork.Log[] memory shortCloseLogs = forkVm.getRecordedLogs();
        assertTrue(_hasTakerFill(shortCloseLogs));
        assertTrue(_hasOrderRequest(shortCloseLogs, 78, 3));
        assertEq(_position(exchange, run.accountId).lotLNS, 0);
    }

    function _exerciseCancel(Run memory run, uint256 bid) private {
        IPerplOrderExchange exchange = IPerplOrderExchange(run.da);
        IPerplOrderExchange.OrderDesc memory resting = _maker(79, bid - 10);
        vm.prank(run.operator);
        IPerplOrderExchange.OrderSignature memory placed = IPerplOrderExchange(run.da).execOrder(resting);
        assertTrue(placed.orderId != 0);
        IPerplOrderExchange.OrderInfo memory liveOrder =
            IPerplOrderExchange(PerplTestnetRegistry.EXCHANGE).getOrder(BTC_PERP_ID, placed.orderId);
        assertEq(uint256(liveOrder.accountId), run.accountId);
        assertEq(uint256(liveOrder.orderType), 0);
        assertEq(uint256(liveOrder.lotLNS), 100);
        assertEq(uint256(liveOrder.orderId), placed.orderId);
        IPerplOrderExchange.OrderDesc memory cancel = _cancel(80, placed.orderId);
        vm.prank(run.operator);
        exchange.execOrder(cancel);
        IPerplSettlementExchange.OrderLock[] memory locks =
            IPerplSettlementExchange(PerplTestnetRegistry.EXCHANGE).getOrderLocks(run.accountId);
        assertEq(locks.length, 0);
    }

    function _selectFork() private {
        forkVm.createSelectFork(forkVm.envOr("MONAD_TESTNET_RPC_URL", "https://testnet-rpc.monad.xyz"));
        assertEq(block.chainid, PerplTestnetRegistry.CHAIN_ID);
    }

    function _activateDirectRun() private returns (Run memory run) {
        run.owner = vm.addr(OWNER_KEY);
        run.operator = vm.addr(OPERATOR_KEY);
        vm.prank(run.owner);
        IPerplOrderFaucet(AUSD_FAUCET).requestFunds(run.owner);
        assertTrue(IPerplOrderToken(PerplTestnetRegistry.AUSD).balanceOf(run.owner) >= FUNDING);

        IPerplTestnetVaultFactory factory = IPerplTestnetVaultFactory(
            address(new PerplStrategyVaultFactory(address(this), run.operator))
        );
        factory.setEnrollmentEnabled(true);
        PerplStrategyMandate.Mandate memory mandate = _mandate(factory, run.owner, run.operator);
        vm.prank(run.owner);
        assertTrue(IPerplOrderToken(PerplTestnetRegistry.AUSD).transfer(mandate.vault, FUNDING));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, factory.mandateDigest(mandate));
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory operatorSignature = _operatorSignature(run.operator, mandate.vault, deadline);
        vm.prank(run.operator);
        run.vault = factory.activateRun(mandate, abi.encodePacked(r, s, v), deadline, operatorSignature);
        run.da = factory.delegatedAccount(run.owner);
        run.accountId = IPerplTestnetAccount(run.da).accountId();
        assertTrue(IPerplTestnetAccount(run.da).operatorAllowlist(IPerplOrderExchange.execOrder.selector));
        vm.prank(IPerplOrderStateExchange(PerplTestnetRegistry.EXCHANGE).owner());
        IPerplOrderStateExchange(PerplTestnetRegistry.EXCHANGE).setIgnOracle(BTC_PERP_ID, true);
    }

    function _mandate(IPerplTestnetVaultFactory factory, address owner, address operator)
        private view returns (PerplStrategyMandate.Mandate memory m)
    {
        m.chainId = PerplTestnetRegistry.CHAIN_ID; m.owner = owner; m.vault = factory.predictVault(owner);
        m.collateralToken = PerplTestnetRegistry.AUSD; m.operator = operator;
        m.transport = PerplStrategyMandate.TRANSPORT_DIRECT_ONCHAIN; m.fundingAmount = FUNDING;
        m.maxPositionExposure = FUNDING * 2; m.maxLeverage = 2; m.durationSeconds = 600;
        m.setupDeadline = uint64(block.timestamp + 5 minutes); m.policyVersion = 2;
        m.nonce = factory.mandateNonce(owner); m.marketIds = new uint256[](1); m.marketIds[0] = BTC_PERP_ID;
    }

    function _operatorSignature(address operator, address vault, uint256 deadline) private returns (bytes memory) {
        address target = PerplTestnetRegistry.DELEGATED_ACCOUNT_FACTORY;
        uint256 nonce = IPerplTestnetFactory(target).operatorNonces(operator);
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, target));
        bytes32 body = keccak256(abi.encode(ASSIGN_OPERATOR_TYPEHASH, vault, nonce, deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OPERATOR_KEY, keccak256(abi.encodePacked("\x19\x01", domain, body)));
        return abi.encodePacked(r, s, v);
    }

    function _ioc(uint256 id, uint8 kind, uint256 price, uint256 lot)
        private pure returns (IPerplOrderExchange.OrderDesc memory d)
    {
        d = IPerplOrderExchange.OrderDesc(id, BTC_PERP_ID, kind, 0, price, lot, 0, false, false, true,
            0, 100, 0, 0, 1000);
    }

    function _maker(uint256 id, uint256 price) private view returns (IPerplOrderExchange.OrderDesc memory d) {
        d = IPerplOrderExchange.OrderDesc(id, BTC_PERP_ID, 0, 0, price, 100, block.number + 1000,
            true, false, false, 0, 100, 0, 0, 0);
    }

    function _cancel(uint256 id, uint256 orderId) private pure returns (IPerplOrderExchange.OrderDesc memory d) {
        d = IPerplOrderExchange.OrderDesc(id, BTC_PERP_ID, 4, orderId, 0, 0, 0, false, false, false,
            0, 0, 0, 0, 0);
    }

    function _position(IPerplOrderStateExchange exchange, uint256 accountId)
        private view returns (IPerplOrderStateExchange.PositionInfo memory position)
    {
        (position,,) = exchange.getPositionV2(BTC_PERP_ID, accountId);
    }

    function _hasTakerFill(VmPerplOrderFork.Log[] memory logs) private pure returns (bool) {
        bytes32 v1 = keccak256("TakerOrderFilled(uint256,uint256,uint256,uint256,uint256,int256,uint256)");
        bytes32 v2 = keccak256("TakerOrderFilledV2(uint256,uint256,uint256,uint256,uint256,int256,uint256,uint256,uint256)");
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == PerplTestnetRegistry.EXCHANGE && logs[i].topics.length == 1
                && (logs[i].topics[0] == v1 || logs[i].topics[0] == v2)) {
                return true;
            }
        }
        return false;
    }

    function _hasOrderRequest(VmPerplOrderFork.Log[] memory logs, uint256 orderDescId, uint8 orderType)
        private pure returns (bool)
    {
        bytes32 requestTopic = keccak256(
            "OrderRequestV2(uint256,uint256,uint256,uint256,uint8,uint256,uint256,uint256,bool,bool,bool,uint256,uint256,uint256,uint256,uint256,uint256,bytes)"
        );
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == PerplTestnetRegistry.EXCHANGE && logs[i].topics.length == 1
                && logs[i].topics[0] == requestTopic) {
                bytes memory data = logs[i].data;
                if (data.length < 19 * 32) return false;
                uint256 decodedOrderDescId;
                uint256 decodedOrderType;
                assembly {
                    decodedOrderDescId := mload(add(data, 0x60))
                    decodedOrderType := mload(add(data, 0xa0))
                }
                if (decodedOrderDescId == orderDescId && decodedOrderType == orderType) return true;
            }
        }
        return false;
    }
}
