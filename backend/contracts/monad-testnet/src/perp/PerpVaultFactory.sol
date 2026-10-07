// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MonadTestnetRegistry} from "../MonadTestnetRegistry.sol";
import {AutonomyTypes, ICircleReceiveAuthorization} from "../autonomy/AutonomyTypes.sol";
import {PerpMandate} from "./PerpMandate.sol";
import {IPerpPool, IPerpClearinghouse} from "./PerpTypes.sol";
import {PerpVault} from "./PerpVault.sol";

/// @notice Separate default-off factory for Mera-approved Monad Testnet perp runs.
contract PerpVaultFactory {
    uint64 public constant MIN_DURATION = 10 minutes;
    uint64 public constant MAX_DURATION = 120 minutes;
    uint64 public constant SETUP_WINDOW = 5 minutes;
    uint256 public constant MIN_FUNDING = 100_000;
    uint256 public constant MAX_FUNDING = 10_000_000;
    uint8 public constant POLICY_VERSION = 1;

    address public immutable administrator;
    address public immutable executor;
    address public immutable usdc;
    address public immutable clearinghouse;
    address[3] private _tokens;
    address[3] private _pools;
    bool public enrollmentEnabled;
    mapping(address => uint256) public enrollmentNonce;
    mapping(address => address) public activeVault;
    uint256 private _entered;

    error WrongChain(); error Unauthorized(); error InvalidConfiguration();
    error EnrollmentDisabled(); error InvalidAuthorization(); error InvalidMandate();
    error InvalidSignature(); error DeploymentFailed(); error ActiveRunExists();

    event EnrollmentGateChanged(bool enabled);
    event VaultCreated(address indexed owner, uint256 indexed nonce, address indexed vault, bytes32 mandateHash);
    event RunReleased(address indexed owner, address indexed vault);

    modifier nonReentrant() { if (_entered != 0) revert Unauthorized(); _entered = 1; _; _entered = 0; }

    constructor(address administrator_, address executor_, address usdc_, address clearinghouse_,
        address[3] memory tokens_, address[3] memory pools_)
    {
        if (block.chainid != MonadTestnetRegistry.CHAIN_ID) revert WrongChain();
        if (administrator_ == address(0) || executor_ == address(0) || usdc_ != MonadTestnetRegistry.USDC
            || usdc_.code.length == 0 || clearinghouse_.code.length == 0) revert InvalidConfiguration();
        administrator = administrator_; executor = executor_; usdc = usdc_; clearinghouse = clearinghouse_;
        for (uint8 i; i < 3; ++i) {
            if (tokens_[i] == address(0) || tokens_[i] == usdc_ || tokens_[i].code.length == 0
                || pools_[i].code.length == 0 || IPerpPool(pools_[i]).usdc() != usdc_
                || IPerpPool(pools_[i]).token() != tokens_[i]) revert InvalidConfiguration();
            for (uint8 j; j < i; ++j) if (tokens_[i] == tokens_[j] || pools_[i] == pools_[j])
                revert InvalidConfiguration();
            _tokens[i] = tokens_[i]; _pools[i] = pools_[i];
        }
    }

    function tokenAt(uint8 index) external view returns (address) {
        if (index >= 3) revert InvalidConfiguration(); return _tokens[index];
    }
    function poolAt(uint8 index) external view returns (address) {
        if (index >= 3) revert InvalidConfiguration(); return _pools[index];
    }

    function setEnrollmentEnabled(bool enabled) external {
        if (msg.sender != administrator) revert Unauthorized();
        enrollmentEnabled = enabled; emit EnrollmentGateChanged(enabled);
    }

    function predictVault(address owner_, uint256 nonce) public view returns (address) {
        bytes32 salt = keccak256(abi.encode(owner_, nonce));
        bytes memory code = abi.encodePacked(type(PerpVault).creationCode, abi.encode(
            owner_, executor, address(this), clearinghouse, usdc, _tokens, _pools
        ));
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff), address(this), salt, keccak256(code)
        )))));
    }

    function mandateDigest(PerpMandate.Mandate calldata mandate) external view returns (bytes32) {
        address predicted = predictVault(mandate.owner, enrollmentNonce[mandate.owner]);
        if (mandate.vault != predicted) revert InvalidMandate();
        return PerpMandate.digest(mandate, address(this));
    }

    function createAndEnroll(AutonomyTypes.CircleAuthorization calldata authorization,
        PerpMandate.Mandate calldata mandate, bytes calldata mandateSignature)
        external nonReentrant returns (address vaultAddress)
    {
        if (block.chainid != MonadTestnetRegistry.CHAIN_ID) revert WrongChain();
        if (!enrollmentEnabled) revert EnrollmentDisabled();
        if (activeVault[mandate.owner] != address(0)) revert ActiveRunExists();
        uint256 nonce = enrollmentNonce[mandate.owner];
        vaultAddress = predictVault(mandate.owner, nonce);
        _validateEnrollment(authorization, mandate, vaultAddress, nonce);
        bytes32 digest = PerpMandate.digest(mandate, address(this));
        if (!PerpMandate.isOwnerSignature(mandate.owner, digest, mandateSignature)) revert InvalidSignature();
        enrollmentNonce[mandate.owner] = nonce + 1;
        PerpVault vault = new PerpVault{salt: keccak256(abi.encode(mandate.owner, nonce))}(
            mandate.owner, executor, address(this), clearinghouse, usdc, _tokens, _pools
        );
        if (address(vault) != vaultAddress) revert DeploymentFailed();
        activeVault[mandate.owner] = vaultAddress;
        IPerpClearinghouse(clearinghouse).registerVault(vaultAddress);
        vault.initializeAndFund(authorization, mandate, mandateSignature, nonce);
        emit VaultCreated(mandate.owner, nonce, vaultAddress, digest);
    }

    function onRunTerminal(address owner_) external {
        if (msg.sender != activeVault[owner_] || msg.sender == address(0)) revert Unauthorized();
        address vault = activeVault[owner_]; delete activeVault[owner_];
        emit RunReleased(owner_, vault);
    }

    function _validateEnrollment(AutonomyTypes.CircleAuthorization calldata auth,
        PerpMandate.Mandate calldata mandate, address predicted, uint256 nonce) private view
    {
        if (mandate.owner == address(0) || mandate.chainId != MonadTestnetRegistry.CHAIN_ID
            || mandate.vault != predicted || mandate.usdc != usdc || mandate.clearinghouse != clearinghouse
            || mandate.executor != executor || mandate.nonce != nonce || mandate.policyVersion != POLICY_VERSION
            || mandate.fundingAmount < MIN_FUNDING || mandate.fundingAmount > MAX_FUNDING
            || mandate.durationSeconds < MIN_DURATION || mandate.durationSeconds > MAX_DURATION
            || mandate.setupDeadline < block.timestamp || mandate.setupDeadline > block.timestamp + SETUP_WINDOW)
            revert InvalidMandate();
        for (uint8 i; i < 3; ++i) {
            if (mandate.tokens[i] != _tokens[i] || mandate.pools[i] != _pools[i]) revert InvalidMandate();
        }
        if (auth.from != mandate.owner || auth.to != predicted || auth.value != mandate.fundingAmount
            || auth.nonce == bytes32(0) || auth.validAfter >= block.timestamp || auth.validBefore <= block.timestamp
            || auth.validBefore > mandate.setupDeadline || (auth.v != 27 && auth.v != 28))
            revert InvalidAuthorization();
    }
}
