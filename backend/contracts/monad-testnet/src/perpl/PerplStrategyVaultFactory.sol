// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PerplTestnetRegistry, IERC20MetadataPerpl, IPerplSettlementExchange} from "./PerplTestnetRegistry.sol";
import {PerplStrategyMandate} from "./PerplStrategyMandate.sol";
import {PerplStrategyVault} from "./PerplStrategyVault.sol";
import {SafeToken} from "../SafeToken.sol";

interface IPerplStrategyVaultState {
    function runNonce() external view returns (uint256);
    function delegatedAccount() external view returns (address);
    function runStatus() external view returns (PerplStrategyVault.RunStatus);
    function activateRun(
        PerplStrategyMandate.Mandate calldata mandate,
        bytes calldata ownerSignature,
        uint256 operatorDeadline,
        bytes calldata operatorSignature
    ) external;
}

/// @notice Default-off factory for persistent per-owner Perpl Testnet vaults.
contract PerplStrategyVaultFactory {
    using SafeToken for address;
    address public immutable administrator;
    address public immutable operator;
    address public immutable collateralToken;
    address public immutable perplFactory;
    address public immutable perplExchange;
    bool public enrollmentEnabled;
    mapping(address => address) public vaultFor;
    uint256 private _entered;

    error Unauthorized();
    error WrongChain();
    error InvalidConfiguration();
    error EnrollmentDisabled();
    error InvalidMandate();
    error InvalidSignature();
    error InsufficientFunding();
    error Reentrant();

    event EnrollmentGateChanged(bool enabled);
    event StrategyVaultCreated(address indexed owner, address indexed vault);
    event RunActivated(address indexed owner, address indexed vault, uint256 indexed nonce, bytes32 mandateHash);

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

    constructor(address administrator_, address operator_) {
        if (block.chainid != PerplTestnetRegistry.CHAIN_ID) revert WrongChain();
        if (
            administrator_ == address(0) || operator_ == address(0) || PerplTestnetRegistry.AUSD.code.length == 0
                || PerplTestnetRegistry.DELEGATED_ACCOUNT_FACTORY.code.length == 0
                || PerplTestnetRegistry.EXCHANGE.code.length == 0
                || IERC20MetadataPerpl(PerplTestnetRegistry.AUSD).decimals() != PerplTestnetRegistry.AUSD_DECIMALS
        ) {
            revert InvalidConfiguration();
        }
        (,,, uint256 exchangeDecimals, address exchangeCollateral,) =
            IPerplSettlementExchange(PerplTestnetRegistry.EXCHANGE).getExchangeInfo();
        if (exchangeDecimals != PerplTestnetRegistry.AUSD_DECIMALS || exchangeCollateral != PerplTestnetRegistry.AUSD) {
            revert InvalidConfiguration();
        }
        administrator = administrator_;
        operator = operator_;
        collateralToken = PerplTestnetRegistry.AUSD;
        perplFactory = PerplTestnetRegistry.DELEGATED_ACCOUNT_FACTORY;
        perplExchange = PerplTestnetRegistry.EXCHANGE;
    }

    function setEnrollmentEnabled(bool enabled) external {
        if (msg.sender != administrator) revert Unauthorized();
        enrollmentEnabled = enabled;
        emit EnrollmentGateChanged(enabled);
    }

    function mandateNonce(address owner) public view returns (uint256) {
        address vault = vaultFor[owner];
        return vault == address(0) ? 0 : IPerplStrategyVaultState(vault).runNonce();
    }

    function predictVault(address owner) public view returns (address) {
        if (owner == address(0)) revert InvalidMandate();
        bytes32 salt = keccak256(abi.encode(owner));
        bytes memory code = abi.encodePacked(
            type(PerplStrategyVault).creationCode,
            abi.encode(owner, operator, address(this), collateralToken, perplFactory, perplExchange)
        );
        return
            address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(code))))));
    }

    function mandateDigest(PerplStrategyMandate.Mandate calldata mandate) external view returns (bytes32) {
        address predicted = predictVault(mandate.owner);
        if (mandate.vault != predicted) revert InvalidMandate();
        return PerplStrategyMandate.digest(mandate, predicted);
    }

    /// @notice Deploys an empty deterministic vault so its owner can recover pre-funded AUSD.
    /// @dev Anyone may deploy it; only the owner can move its AUSD until a signed run activates.
    function createVault(address owner) external returns (address vault) {
        if (owner == address(0)) revert InvalidMandate();
        vault = vaultFor[owner];
        if (vault == address(0)) vault = _deployVault(owner);
    }

    function activateRun(
        PerplStrategyMandate.Mandate calldata mandate,
        bytes calldata ownerSignature,
        uint256 operatorDeadline,
        bytes calldata operatorSignature
    ) external onlyOperator nonReentrant returns (address vault) {
        if (block.chainid != PerplTestnetRegistry.CHAIN_ID) revert WrongChain();
        if (!enrollmentEnabled) revert EnrollmentDisabled();
        vault = predictVault(mandate.owner);
        _validateMandate(mandate, vault);
        bytes32 digest = PerplStrategyMandate.digest(mandate, vault);
        if (!PerplStrategyMandate.isOwnerSignature(mandate.owner, digest, ownerSignature)) revert InvalidSignature();
        if (collateralToken.balanceOf(vault) < mandate.fundingAmount) revert InsufficientFunding();

        address existing = vaultFor[mandate.owner];
        if (existing == address(0)) {
            vault = _deployVault(mandate.owner);
        } else if (existing != vault) {
            revert InvalidConfiguration();
        }
        if (mandate.nonce != IPerplStrategyVaultState(vault).runNonce()) revert InvalidMandate();
        IPerplStrategyVaultState(vault).activateRun(mandate, ownerSignature, operatorDeadline, operatorSignature);
        emit RunActivated(mandate.owner, vault, mandate.nonce, digest);
    }

    function _deployVault(address owner) private returns (address vault) {
        vault = predictVault(owner);
        PerplStrategyVault deployed = new PerplStrategyVault{salt: keccak256(abi.encode(owner))}(
            owner, operator, address(this), collateralToken, perplFactory, perplExchange
        );
        if (address(deployed) != vault) revert InvalidConfiguration();
        vaultFor[owner] = vault;
        emit StrategyVaultCreated(owner, vault);
    }

    function runStatus(address owner) external view returns (PerplStrategyVault.RunStatus) {
        address vault = vaultFor[owner];
        if (vault == address(0)) return PerplStrategyVault.RunStatus.Idle;
        return IPerplStrategyVaultState(vault).runStatus();
    }

    function delegatedAccount(address owner) external view returns (address) {
        address vault = vaultFor[owner];
        return vault == address(0) ? address(0) : IPerplStrategyVaultState(vault).delegatedAccount();
    }

    function _validateMandate(PerplStrategyMandate.Mandate calldata m, address predicted) private view {
        if (
            m.owner == address(0) || m.chainId != PerplTestnetRegistry.CHAIN_ID || m.vault != predicted
                || m.collateralToken != collateralToken || m.operator != operator || m.nonce != mandateNonce(m.owner)
                || m.policyVersion != 2
                || (m.transport != PerplStrategyMandate.TRANSPORT_DIRECT_ONCHAIN
                    && m.transport != PerplStrategyMandate.TRANSPORT_API_FORWARDING)
                || m.fundingAmount == 0 || m.setupDeadline < block.timestamp
                || m.setupDeadline > block.timestamp + 5 minutes
        ) {
            revert InvalidMandate();
        }
    }
}
