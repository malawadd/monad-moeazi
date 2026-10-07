// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase, VmTest} from "../TestBase.sol";
import {
    PerplTestnetRegistry,
    IPerplSettlementExchange,
    IPerplOrderExchange
} from "../../src/perpl/PerplTestnetRegistry.sol";
import {PerplStrategyMandate} from "../../src/perpl/PerplStrategyMandate.sol";
import {PerplStrategyVaultFactory} from "../../src/perpl/PerplStrategyVaultFactory.sol";

interface VmForkTest is VmTest {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }
    function createSelectFork(string calldata rpcUrl) external returns (uint256 forkId);
    function envOr(string calldata name, string calldata defaultValue) external returns (string memory value);
    function expectRevert() external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

interface IPerplFactoryFork {
    function EXCHANGE() external view returns (address);
    function operatorNonces(address operator) external view returns (uint256);
    function create(address operator, uint256 deadline, bytes calldata operatorSignature) external returns (address);
}

interface IPerplAccountFork {
    function owner() external view returns (address);
    function exchange() external view returns (address);
    function accountId() external view returns (uint256);
    function isOperator(address operator) external view returns (bool);
    function operatorAllowlist(bytes4 selector) external view returns (bool);
    function withdrawCollateral(uint256 amount) external;
}

interface IERC20DecimalsFork {
    function decimals() external view returns (uint8);
}

interface IERC20Fork is IERC20DecimalsFork {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IAgoraAUSDFaucetFork {
    function requestFunds(address recipient) external;
}

/// @notice Runs against Monad Testnet state but mutates only a local Foundry fork.
contract PerplStrategyForkCompatibilityTest is TestBase {
    uint256 private constant OPERATOR_KEY = 0x0B0B;
    uint256 private constant OWNER_KEY = 0xA11CE;
    address private constant AUSD_FAUCET = 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C;
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("DelegatedAccountFactory");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant ASSIGN_OPERATOR_TYPEHASH =
        keccak256("AssignOperator(address owner,uint256 nonce,uint256 deadline)");
    VmForkTest private constant forkVm = VmForkTest(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct ForkActivation {
        address owner;
        address operator;
        uint256 funding;
        uint256 operatorDeadline;
        address vault;
        address da;
        PerplStrategyVaultFactory strategyFactory;
        PerplStrategyMandate.Mandate mandate;
        bytes ownerSignature;
        bytes operatorSignature;
    }

    function testMonadForkUsesLivePerplFactoryExchangeAndAUSD() public {
        string memory rpc = forkVm.envOr("MONAD_TESTNET_RPC_URL", "https://testnet-rpc.monad.xyz");
        forkVm.createSelectFork(rpc);
        assertEq(block.chainid, PerplTestnetRegistry.CHAIN_ID);
        assertTrue(PerplTestnetRegistry.AUSD.code.length != 0);
        assertTrue(PerplTestnetRegistry.DELEGATED_ACCOUNT_FACTORY.code.length != 0);
        assertTrue(PerplTestnetRegistry.EXCHANGE.code.length != 0);
        assertEq(uint256(IERC20DecimalsFork(PerplTestnetRegistry.AUSD).decimals()), 6);

        address factoryAddress = PerplTestnetRegistry.DELEGATED_ACCOUNT_FACTORY;
        assertEq(IPerplFactoryFork(factoryAddress).EXCHANGE(), PerplTestnetRegistry.EXCHANGE);
        (bool ok, bytes memory response) =
            PerplTestnetRegistry.EXCHANGE.staticcall(abi.encodeWithSelector(bytes4(keccak256("getExchangeInfo()"))));
        assertTrue(ok);
        (,,, uint256 collateralDecimals, address collateralToken,) =
            abi.decode(response, (uint256, uint256, uint256, uint256, address, address));
        assertEq(collateralDecimals, 6);
        assertEq(collateralToken, PerplTestnetRegistry.AUSD);
        _assertSettlementReadAbi();

        address operator = vm.addr(OPERATOR_KEY);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = IPerplFactoryFork(factoryAddress).operatorNonces(operator);
        bytes32 domain = keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, PerplTestnetRegistry.CHAIN_ID, factoryAddress)
        );
        bytes32 structHash = keccak256(abi.encode(ASSIGN_OPERATOR_TYPEHASH, address(this), nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OPERATOR_KEY, digest);
        address da = IPerplFactoryFork(factoryAddress).create(operator, deadline, abi.encodePacked(r, s, v));
        assertTrue(da.code.length != 0);
        assertEq(IPerplAccountFork(da).owner(), address(this));
        assertEq(IPerplAccountFork(da).exchange(), PerplTestnetRegistry.EXCHANGE);
        assertEq(IPerplAccountFork(da).accountId(), 0);
        assertTrue(IPerplAccountFork(da).isOperator(operator));
        forkVm.expectRevert();
        vm.prank(operator);
        IPerplAccountFork(da).withdrawCollateral(1);
    }

    function testMonadForkActivatesAgainstLiveAUSDFaucetAndPerplAccountSetup() public {
        _selectFork();
        ForkActivation memory state = _prepareActivation();
        _activateForkRun(state);
        _assertActivatedAccount(state);
        VmForkTest.Log[] memory logs = forkVm.getRecordedLogs();
        assertTrue(_hasForwardingEvent(logs, false));
        IPerplOrderExchange.OrderDesc memory malformed;
        vm.prank(state.operator);
        (bool orderOk, bytes memory orderError) = state.da.call(
            abi.encodeCall(IPerplOrderExchange.execOrder, (malformed))
        );
        assertFalse(orderOk);
        assertTrue(orderError.length >= 4);
        bytes4 orderErrorSelector;
        assembly ("memory-safe") { orderErrorSelector := mload(add(orderError, 32)) }
        assertTrue(orderErrorSelector != bytes4(keccak256("SelectorNotAllowed(bytes4)")));
    }

    function _selectFork() private {
        string memory rpc = forkVm.envOr("MONAD_TESTNET_RPC_URL", "https://testnet-rpc.monad.xyz");
        forkVm.createSelectFork(rpc);
    }

    function _prepareActivation() private returns (ForkActivation memory state) {
        assertTrue(AUSD_FAUCET.code.length != 0);
        state.owner = vm.addr(OWNER_KEY);
        state.operator = vm.addr(OPERATOR_KEY);
        state.funding = PerplTestnetRegistry.MIN_ACCOUNT_CREATION_AUSD;
        vm.prank(state.owner);
        IAgoraAUSDFaucetFork(AUSD_FAUCET).requestFunds(state.owner);
        IERC20Fork ausd = IERC20Fork(PerplTestnetRegistry.AUSD);
        assertTrue(ausd.balanceOf(state.owner) >= state.funding);

        state.strategyFactory = new PerplStrategyVaultFactory(address(this), state.operator);
        state.strategyFactory.setEnrollmentEnabled(true);
        state.mandate = _mandate(state.strategyFactory, state.owner, state.operator, state.funding);
        vm.prank(state.owner);
        assertTrue(ausd.transfer(state.mandate.vault, state.funding));
        state.ownerSignature = _ownerSignature(state.strategyFactory, state.mandate);
        state.operatorDeadline = block.timestamp + 1 hours;
        state.operatorSignature = _operatorSignature(state.operator, state.mandate.vault, state.operatorDeadline);
    }

    function _ownerSignature(PerplStrategyVaultFactory strategyFactory, PerplStrategyMandate.Mandate memory mandate)
        private
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, strategyFactory.mandateDigest(mandate));
        return abi.encodePacked(r, s, v);
    }

    function _activateForkRun(ForkActivation memory state) private {
        forkVm.recordLogs();
        vm.prank(state.operator);
        state.vault = state.strategyFactory
            .activateRun(state.mandate, state.ownerSignature, state.operatorDeadline, state.operatorSignature);
        state.da = state.strategyFactory.delegatedAccount(state.owner);
    }

    function _assertActivatedAccount(ForkActivation memory state) private view {
        assertEq(state.vault, state.mandate.vault);
        assertTrue(state.da.code.length != 0);
        IPerplAccountFork da = IPerplAccountFork(state.da);
        assertEq(da.owner(), state.vault);
        assertEq(da.exchange(), PerplTestnetRegistry.EXCHANGE);
        assertTrue(da.accountId() != 0);
        assertTrue(da.isOperator(state.operator));
        assertTrue(da.operatorAllowlist(IPerplOrderExchange.execOrder.selector));
        assertTrue(da.operatorAllowlist(IPerplOrderExchange.execOrders.selector));
        IPerplSettlementExchange.AccountInfo memory account =
            IPerplSettlementExchange(PerplTestnetRegistry.EXCHANGE).getAccountById(da.accountId());
        assertEq(account.accountId, da.accountId());
        assertTrue(account.balanceCNS >= state.funding);
        assertEq(account.accountAddr, state.da);
    }

    function _assertSettlementReadAbi() private view {
        IPerplSettlementExchange exchange = IPerplSettlementExchange(PerplTestnetRegistry.EXCHANGE);
        bool accountDecoded = _accountReadDecodes(exchange, 0) || _accountReadDecodes(exchange, 1);
        bool locksDecoded = _orderLocksReadDecodes(exchange, 0) || _orderLocksReadDecodes(exchange, 1);
        assertTrue(accountDecoded);
        assertTrue(locksDecoded);
    }

    function _mandate(PerplStrategyVaultFactory strategyFactory, address owner, address operator, uint256 funding)
        private
        view
        returns (PerplStrategyMandate.Mandate memory mandate)
    {
        mandate.chainId = PerplTestnetRegistry.CHAIN_ID;
        mandate.owner = owner;
        mandate.vault = strategyFactory.predictVault(owner);
        mandate.collateralToken = PerplTestnetRegistry.AUSD;
        mandate.operator = operator;
        mandate.transport = PerplStrategyMandate.TRANSPORT_DIRECT_ONCHAIN;
        mandate.fundingAmount = funding;
        mandate.maxPositionExposure = funding * 2;
        mandate.maxLeverage = 2;
        mandate.durationSeconds = 600;
        mandate.setupDeadline = uint64(block.timestamp + 5 minutes);
        mandate.policyVersion = 2;
        mandate.nonce = strategyFactory.mandateNonce(owner);
        mandate.marketIds = new uint256[](1);
        mandate.marketIds[0] = 1;
    }

    function _operatorSignature(address operator, address vault, uint256 deadline) private returns (bytes memory) {
        uint256 nonce = IPerplFactoryFork(PerplTestnetRegistry.DELEGATED_ACCOUNT_FACTORY).operatorNonces(operator);
        bytes32 domain = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                NAME_HASH,
                VERSION_HASH,
                PerplTestnetRegistry.CHAIN_ID,
                PerplTestnetRegistry.DELEGATED_ACCOUNT_FACTORY
            )
        );
        bytes32 structHash = keccak256(abi.encode(ASSIGN_OPERATOR_TYPEHASH, vault, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OPERATOR_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _hasForwardingEvent(VmForkTest.Log[] memory logs, bool expected) private pure returns (bool) {
        bytes32 eventSignature = keccak256("OrderForwardingUpdated(uint256,bool)");
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != PerplTestnetRegistry.EXCHANGE || logs[i].topics.length == 0
                || logs[i].topics[0] != eventSignature) continue;
            if (logs[i].topics.length >= 3) return uint256(logs[i].topics[2]) == (expected ? 1 : 0);
            if (logs[i].data.length == 32) return abi.decode(logs[i].data, (bool)) == expected;
            if (logs[i].data.length == 64) {
                (, bool allowed) = abi.decode(logs[i].data, (uint256, bool));
                return allowed == expected;
            }
        }
        return false;
    }

    function _accountReadDecodes(IPerplSettlementExchange exchange, uint256 accountId) private view returns (bool) {
        (bool ok, bytes memory result) =
            address(exchange).staticcall(abi.encodeWithSelector(exchange.getAccountById.selector, accountId));
        if (!ok || result.length != 9 * 32) return false;
        IPerplSettlementExchange.AccountInfo memory account = abi.decode(result, (IPerplSettlementExchange.AccountInfo));
        return account.accountId == accountId;
    }

    function _orderLocksReadDecodes(IPerplSettlementExchange exchange, uint256 accountId) private view returns (bool) {
        (bool ok, bytes memory result) =
            address(exchange).staticcall(abi.encodeWithSelector(exchange.getOrderLocks.selector, accountId));
        if (!ok || result.length < 2 * 32) return false;
        abi.decode(result, (IPerplSettlementExchange.OrderLock[]));
        return true;
    }
}
