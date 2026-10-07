// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SafeToken} from "../SafeToken.sol";
import {PerplTestnetRegistry, IPerplDelegatedAccount, IPerplDelegatedAccountFactory, IPerplSettlementExchange, IPerplOrderExchange} from "./PerplTestnetRegistry.sol";
import {PerplStrategyMandate} from "./PerplStrategyMandate.sol";

interface IPerplStrategyFactoryGate {
    function enrollmentEnabled() external view returns (bool);
    function perplExchange() external view returns (address);
}

/// @notice Reusable owner vault that owns one Perpl delegated account for Testnet runs.
contract PerplStrategyVault {
    using SafeToken for address;

    enum RunStatus { Idle, Active, StopRequested, SettlementReady, Settled }

    address public immutable owner;
    address public immutable operator;
    address public immutable factory;
    address public immutable collateralToken;
    address public immutable perplFactory;
    address public immutable perplExchange;
    address public delegatedAccount;
    uint256 public runNonce;
    uint256 public fundedAmount;
    uint256 public maxPositionExposure;
    uint8 public maxLeverage;
    uint8 public transport;
    uint64 public activatedAt;
    uint64 public expiresAt;
    bytes32 public mandateHash;
    bytes32 public settlementReadyHash;
    uint256 public settlementBalanceCNS;
    RunStatus public runStatus;
    uint256[] private _marketIds;
    uint256 private _entered;

    error Unauthorized();
    error InvalidRun();
    error InvalidSignature();
    error EnrollmentDisabled();
    error InsufficientFunding();
    error AccountSetupFailed();
    error SettlementNotReady();
    error RecoveryUnavailable();
    error Reentrant();

    event RunActivated(address indexed owner, address indexed vault, uint256 indexed nonce,
        address delegatedAccount, uint256 fundingAmount, uint256 maxPositionExposure,
        uint8 maxLeverage, uint64 activatedAt, uint64 expiresAt, bytes32 mandateHash, uint8 transport);
    event StopRequested(address indexed owner, uint256 indexed nonce);
    event SettlementReady(address indexed owner, uint256 indexed nonce, bytes32 accountStateHash);
    event SettlementCompleted(address indexed owner, uint256 indexed nonce, uint256 returnedAUSD);
    event RecoveryWithdrawal(address indexed owner, uint256 amount);
    event ForwardingChanged(address indexed owner, bool allowed);
    event CounterfactualFundingRecovered(address indexed owner, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }
    modifier nonReentrant() {
        if (_entered != 0) revert Reentrant();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(address owner_, address operator_, address factory_, address collateralToken_,
        address perplFactory_, address perplExchange_) {
        if (
            owner_ == address(0) || operator_ == address(0) || factory_ == address(0)
                || collateralToken_ != PerplTestnetRegistry.AUSD
                || perplFactory_ != PerplTestnetRegistry.DELEGATED_ACCOUNT_FACTORY
                || perplExchange_ != PerplTestnetRegistry.EXCHANGE
        ) revert InvalidRun();
        owner = owner_;
        operator = operator_;
        factory = factory_;
        collateralToken = collateralToken_;
        perplFactory = perplFactory_;
        perplExchange = perplExchange_;
    }

    function activateRun(
        PerplStrategyMandate.Mandate calldata mandate,
        bytes calldata ownerSignature,
        uint256 operatorDeadline,
        bytes calldata operatorSignature
    ) external nonReentrant {
        if (msg.sender != factory) revert Unauthorized();
        if (!IPerplStrategyFactoryGate(factory).enrollmentEnabled()) revert EnrollmentDisabled();
        _validateMandate(mandate);
        bytes32 digest = PerplStrategyMandate.digest(mandate, address(this));
        if (!PerplStrategyMandate.isOwnerSignature(owner, digest, ownerSignature)) revert InvalidSignature();

        address da = delegatedAccount;
        if (da == address(0)) {
            da = IPerplDelegatedAccountFactory(perplFactory).create(operator, operatorDeadline, operatorSignature);
            if (
                da.code.length == 0 || IPerplDelegatedAccount(da).owner() != address(this)
                    || IPerplDelegatedAccount(da).exchange() != perplExchange
            ) revert AccountSetupFailed();
            delegatedAccount = da;
        } else if (!IPerplDelegatedAccount(da).isOperator(operator)) {
            IPerplDelegatedAccount(da).addOperator(operator, operatorDeadline, operatorSignature);
            if (!IPerplDelegatedAccount(da).isOperator(operator)) revert AccountSetupFailed();
        }

        uint256 accountId = IPerplDelegatedAccount(da).accountId();
        if (accountId == 0 && mandate.fundingAmount < PerplTestnetRegistry.MIN_ACCOUNT_CREATION_AUSD) {
            revert InsufficientFunding();
        }
        uint256 beforeBalance = collateralToken.balanceOf(address(this));
        if (beforeBalance < mandate.fundingAmount) revert InsufficientFunding();
        collateralToken.safeTransfer(da, mandate.fundingAmount);
        if (beforeBalance - collateralToken.balanceOf(address(this)) != mandate.fundingAmount) {
            revert InsufficientFunding();
        }
        if (accountId == 0) IPerplDelegatedAccount(da).createAccount(mandate.fundingAmount);
        else IPerplDelegatedAccount(da).depositCollateral(mandate.fundingAmount);
        IPerplDelegatedAccount(da).setOperatorAllowlist(
            IPerplOrderExchange.execOrder.selector,
            mandate.transport == PerplStrategyMandate.TRANSPORT_DIRECT_ONCHAIN
        );
        IPerplDelegatedAccount(da).setOperatorAllowlist(
            IPerplOrderExchange.execOrders.selector,
            mandate.transport == PerplStrategyMandate.TRANSPORT_DIRECT_ONCHAIN
        );
        IPerplDelegatedAccount(da).allowOrderForwarding(
            mandate.transport == PerplStrategyMandate.TRANSPORT_API_FORWARDING
        );

        _storeRun(mandate, digest);
    }

    function requestStop() external onlyOwner {
        if (runStatus != RunStatus.Active) revert InvalidRun();
        runStatus = RunStatus.StopRequested;
        emit StopRequested(owner, runNonce - 1);
    }

    /// @dev The executor calls this after confirmed onchain cancellation/close reconciliation.
    function markSettlementReady(bytes32 accountStateHash) external onlyOperator {
        bool stopped = runStatus == RunStatus.StopRequested;
        bool expired = runStatus == RunStatus.Active && block.timestamp >= expiresAt;
        if ((!stopped && !expired) || accountStateHash == bytes32(0)) revert SettlementNotReady();
        settlementBalanceCNS = _readSettlementBalance();
        runStatus = RunStatus.SettlementReady;
        settlementReadyHash = accountStateHash;
        emit SettlementReady(owner, runNonce - 1, accountStateHash);
    }

    /// @dev Perpl's delegated account sends withdrawals to this vault; this vault returns AUSD to its owner.
    function completeSettlement(uint256 withdrawAmount) external nonReentrant {
        if (msg.sender != owner && msg.sender != operator) revert Unauthorized();
        if (runStatus != RunStatus.SettlementReady || settlementReadyHash == bytes32(0)) {
            revert SettlementNotReady();
        }
        if (withdrawAmount != settlementBalanceCNS || _readSettlementBalance() != withdrawAmount) {
            revert SettlementNotReady();
        }
        address da = delegatedAccount;
        if (da == address(0)) revert RecoveryUnavailable();
        IPerplDelegatedAccount(da).allowOrderForwarding(false);
        if (IPerplDelegatedAccount(da).isOperator(operator)) {
            IPerplDelegatedAccount(da).removeOperator(operator);
        }
        if (withdrawAmount != 0) IPerplDelegatedAccount(da).withdrawCollateral(withdrawAmount);
        uint256 returned = collateralToken.balanceOf(address(this));
        if (returned != 0) collateralToken.safeTransfer(owner, returned);
        runStatus = RunStatus.Settled;
        emit SettlementCompleted(owner, runNonce - 1, returned);
    }

    function setForwardingForRecovery(bool allowed) external onlyOwner {
        if (delegatedAccount == address(0)) revert RecoveryUnavailable();
        if (allowed && transport == PerplStrategyMandate.TRANSPORT_DIRECT_ONCHAIN
            && runStatus != RunStatus.Idle && runStatus != RunStatus.Settled) revert InvalidRun();
        IPerplDelegatedAccount(delegatedAccount).allowOrderForwarding(allowed);
        emit ForwardingChanged(owner, allowed);
    }

    function recoverWithdrawCollateral(uint256 amount) external onlyOwner nonReentrant {
        if (!_recoveryAllowed() || delegatedAccount == address(0)) revert RecoveryUnavailable();
        uint256 available = _readSettlementBalance();
        if (amount > available) revert RecoveryUnavailable();
        address da = delegatedAccount;
        IPerplDelegatedAccount(da).allowOrderForwarding(false);
        if (IPerplDelegatedAccount(da).isOperator(operator)) IPerplDelegatedAccount(da).removeOperator(operator);
        if (amount != 0) IPerplDelegatedAccount(da).withdrawCollateral(amount);
        uint256 recovered = collateralToken.balanceOf(address(this));
        if (recovered != 0) collateralToken.safeTransfer(owner, recovered);
        emit RecoveryWithdrawal(owner, recovered);
    }

    function recoverRescueAUSD(uint256 amount) external onlyOwner nonReentrant {
        if (!_recoveryAllowed() || delegatedAccount == address(0) || amount == 0) revert RecoveryUnavailable();
        IPerplDelegatedAccount(delegatedAccount).rescueTokens(collateralToken, amount);
        uint256 recovered = collateralToken.balanceOf(address(this));
        if (recovered != 0) collateralToken.safeTransfer(owner, recovered);
        emit RecoveryWithdrawal(owner, recovered);
    }

    /// @notice Returns AUSD sent to this deterministic address before enrollment completed.
    /// @dev Permissionless vault deployment followed by this owner-only call recovers prefunding.
    function recoverVaultFunding() external onlyOwner nonReentrant {
        if (runStatus != RunStatus.Idle && runStatus != RunStatus.Settled) revert RecoveryUnavailable();
        uint256 balance = collateralToken.balanceOf(address(this));
        if (balance == 0) revert RecoveryUnavailable();
        collateralToken.safeTransfer(owner, balance);
        emit CounterfactualFundingRecovered(owner, balance);
    }

    function revokeOperator() external onlyOwner {
        if (delegatedAccount == address(0)) revert RecoveryUnavailable();
        IPerplDelegatedAccount(delegatedAccount).removeOperator(operator);
    }

    function restoreOperator(uint256 deadline, bytes calldata signature) external onlyOwner {
        if (delegatedAccount == address(0)) revert RecoveryUnavailable();
        IPerplDelegatedAccount(delegatedAccount).addOperator(operator, deadline, signature);
    }

    function vaultAUSD() external view returns (uint256) {
        return collateralToken.balanceOf(address(this));
    }

    function marketIds() external view returns (uint256[] memory) {
        return _marketIds;
    }

    function isExpired() external view returns (bool) {
        return expiresAt != 0 && block.timestamp >= expiresAt;
    }

    function _validateMandate(PerplStrategyMandate.Mandate calldata m) private view {
        if ((runStatus != RunStatus.Idle && runStatus != RunStatus.Settled)
            || m.chainId != PerplTestnetRegistry.CHAIN_ID || block.chainid != PerplTestnetRegistry.CHAIN_ID
            || m.owner != owner || m.vault != address(this) || m.collateralToken != collateralToken
            || m.operator != operator || m.nonce != runNonce || m.policyVersion != 2
            || (m.transport != PerplStrategyMandate.TRANSPORT_DIRECT_ONCHAIN && m.transport != PerplStrategyMandate.TRANSPORT_API_FORWARDING)
            || m.fundingAmount == 0 || m.maxPositionExposure == 0 || m.maxLeverage == 0
            || m.fundingAmount > type(uint256).max / m.maxLeverage
            || m.maxPositionExposure > m.fundingAmount * uint256(m.maxLeverage) || m.durationSeconds == 0
            || uint256(m.durationSeconds) > type(uint64).max - block.timestamp || m.setupDeadline < block.timestamp
            || m.setupDeadline > block.timestamp + 5 minutes || m.marketIds.length == 0 || m.marketIds.length > 16
        ) revert InvalidRun();
        for (uint256 i; i < m.marketIds.length; ++i) {
            if (m.marketIds[i] == 0) revert InvalidRun();
            for (uint256 j; j < i; ++j) {
                if (m.marketIds[i] == m.marketIds[j]) revert InvalidRun();
            }
        }
    }

    function _storeRun(PerplStrategyMandate.Mandate calldata m, bytes32 digest) private {
        delete _marketIds;
        for (uint256 i; i < m.marketIds.length; ++i) {
            _marketIds.push(m.marketIds[i]);
        }
        fundedAmount = m.fundingAmount;
        maxPositionExposure = m.maxPositionExposure;
        maxLeverage = m.maxLeverage; transport = m.transport;
        activatedAt = uint64(block.timestamp);
        expiresAt = uint64(block.timestamp + m.durationSeconds);
        mandateHash = digest;
        settlementReadyHash = bytes32(0);
        runStatus = RunStatus.Active;
        runNonce = m.nonce + 1;
        emit RunActivated(
            owner,
            address(this),
            m.nonce,
            delegatedAccount,
            fundedAmount,
            maxPositionExposure,
            maxLeverage,
            activatedAt,
            expiresAt,
            digest,
            transport
        );
    }

    function _recoveryAllowed() private view returns (bool) {
        return runStatus == RunStatus.StopRequested || runStatus == RunStatus.SettlementReady
            || runStatus == RunStatus.Settled || (runStatus == RunStatus.Active && block.timestamp >= expiresAt);
    }

    function _readSettlementBalance() private view returns (uint256 balance) {
        uint256 accountId = IPerplDelegatedAccount(delegatedAccount).accountId();
        if (accountId == 0) revert SettlementNotReady();
        IPerplSettlementExchange.AccountInfo memory account =
            IPerplSettlementExchange(perplExchange).getAccountById(accountId);
        if (
            account.accountId != accountId || account.lockedBalanceCNS != 0 || account.positions.bank1 != 0
                || account.positions.bank2 != 0 || account.positions.bank3 != 0 || account.positions.bank4 != 0
        ) revert SettlementNotReady();
        IPerplSettlementExchange.OrderLock[] memory locks =
            IPerplSettlementExchange(perplExchange).getOrderLocks(accountId);
        if (locks.length != 0) revert SettlementNotReady();
        return account.balanceCNS;
    }
}
