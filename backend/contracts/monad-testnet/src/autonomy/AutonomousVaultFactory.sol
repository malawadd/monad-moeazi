// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MonadTestnetRegistry} from "../MonadTestnetRegistry.sol";
import {AutonomyTypes, ICircleReceiveAuthorization, IAutonomyPairPool} from "./AutonomyTypes.sol";
import {AutonomyMandate} from "./AutonomyMandate.sol";
import {MoeaziAutonomousVault} from "./MoeaziAutonomousVault.sol";

/// @notice Creates one immutable asset-scoped vault for each owner enrollment nonce.
contract AutonomousVaultFactory {
    uint64 public constant MIN_DURATION = 10 minutes;
    uint64 public constant MAX_DURATION = 120 minutes;
    uint64 public constant SETUP_WINDOW = 5 minutes;
    uint256 public constant MIN_FUNDING = 100_000;
    uint256 public constant MAX_FUNDING = 10_000_000;

    address public immutable administrator;
    address public immutable executor;
    address public immutable usdc;
    address[3] private _tokens;
    address[3] private _pools;
    bool public enrollmentEnabled;
    mapping(address => uint256) public enrollmentNonce;
    uint256 private _entered;

    error WrongChain();
    error Unauthorized();
    error EnrollmentDisabled();
    error InvalidConfiguration();
    error InvalidAuthorization();
    error InvalidMandate();
    error InvalidSignature();
    error DeploymentFailed();

    event EnrollmentGateChanged(bool enabled);
    event VaultCreated(address indexed owner, uint256 indexed nonce, address indexed vault, bytes32 mandateHash);

    modifier nonReentrant() {
        if (_entered != 0) revert Unauthorized();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(address administrator_, address executor_, address usdc_,
        address[3] memory tokens_, address[3] memory pools_)
    {
        if (block.chainid != MonadTestnetRegistry.CHAIN_ID) revert WrongChain();
        if (administrator_ == address(0) || executor_ == address(0)
            || usdc_ != MonadTestnetRegistry.USDC || usdc_.code.length == 0) revert InvalidConfiguration();
        administrator = administrator_;
        executor = executor_;
        usdc = usdc_;
        for (uint8 i; i < 3; ++i) {
            if (tokens_[i] == address(0) || tokens_[i] == usdc_ || tokens_[i].code.length == 0
                || pools_[i].code.length == 0 || IAutonomyPairPool(pools_[i]).usdc() != usdc_
                || IAutonomyPairPool(pools_[i]).token() != tokens_[i]) revert InvalidConfiguration();
            for (uint8 j; j < i; ++j) {
                if (tokens_[i] == tokens_[j] || pools_[i] == pools_[j]) revert InvalidConfiguration();
            }
            _tokens[i] = tokens_[i];
            _pools[i] = pools_[i];
        }
    }

    function tokenAt(uint8 index) external view returns (address) {
        if (index >= 3) revert InvalidConfiguration();
        return _tokens[index];
    }

    function poolAt(uint8 index) external view returns (address) {
        if (index >= 3) revert InvalidConfiguration();
        return _pools[index];
    }

    function setEnrollmentEnabled(bool enabled) external {
        if (msg.sender != administrator) revert Unauthorized();
        enrollmentEnabled = enabled;
        emit EnrollmentGateChanged(enabled);
    }

    function predictVault(address owner, uint256 nonce) public view returns (address) {
        bytes32 salt = keccak256(abi.encode(owner, nonce));
        bytes memory initCode = abi.encodePacked(type(MoeaziAutonomousVault).creationCode,
            abi.encode(owner, executor, address(this), usdc, _tokens, _pools));
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(initCode)));
        return address(uint160(uint256(hash)));
    }

    function mandateDigest(AutonomyMandate.StrategyMandate calldata mandate) external view returns (bytes32) {
        address predicted = predictVault(mandate.owner, enrollmentNonce[mandate.owner]);
        if (mandate.vault != predicted) revert InvalidMandate();
        return AutonomyMandate.digest(mandate, predicted);
    }

    function createAndEnroll(
        AutonomyTypes.CircleAuthorization calldata authorization,
        AutonomyMandate.StrategyMandate calldata mandate,
        bytes calldata mandateSignature
    ) external nonReentrant returns (address vaultAddress) {
        if (!enrollmentEnabled) revert EnrollmentDisabled();
        uint256 nonce = enrollmentNonce[mandate.owner];
        vaultAddress = predictVault(mandate.owner, nonce);
        _validateEnrollment(authorization, mandate, vaultAddress, nonce);
        bytes32 digest = AutonomyMandate.digest(mandate, vaultAddress);
        if (!AutonomyMandate.isOwnerSignature(mandate.owner, digest, mandateSignature)) revert InvalidSignature();

        enrollmentNonce[mandate.owner] = nonce + 1;
        bytes32 salt = keccak256(abi.encode(mandate.owner, nonce));
        MoeaziAutonomousVault vault = new MoeaziAutonomousVault{salt: salt}(
            mandate.owner, executor, address(this), usdc, _tokens, _pools
        );
        if (address(vault) != vaultAddress) revert DeploymentFailed();
        vault.initializeAndFund(authorization, mandate, mandateSignature, nonce);
        emit VaultCreated(mandate.owner, nonce, vaultAddress, digest);
    }

    function _validateEnrollment(
        AutonomyTypes.CircleAuthorization calldata authorization,
        AutonomyMandate.StrategyMandate calldata mandate,
        address predicted,
        uint256 expectedNonce
    ) private view {
        if (mandate.owner == address(0) || mandate.chainId != MonadTestnetRegistry.CHAIN_ID
            || mandate.vault != predicted || mandate.usdc != usdc || mandate.nonce != expectedNonce
            || mandate.fundingAmount < MIN_FUNDING || mandate.fundingAmount > MAX_FUNDING
            || mandate.durationSeconds < MIN_DURATION || mandate.durationSeconds > MAX_DURATION
            || mandate.startBy < block.timestamp || mandate.startBy > block.timestamp + SETUP_WINDOW
            || mandate.maxCycles != 3 || mandate.buySlippageBps > 500 || mandate.sellSlippageBps > 500) {
            revert InvalidMandate();
        }
        for (uint8 i; i < 3; ++i) {
            if (mandate.tokens[i] != _tokens[i] || mandate.pools[i] != _pools[i]) revert InvalidMandate();
        }
        if (authorization.from != mandate.owner || authorization.to != predicted
            || authorization.value != mandate.fundingAmount || authorization.nonce == bytes32(0)
            || authorization.validAfter >= block.timestamp || authorization.validBefore <= block.timestamp
            || authorization.validBefore > block.timestamp + SETUP_WINDOW
            || (authorization.v != 27 && authorization.v != 28)) revert InvalidAuthorization();
    }
}
