// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ISwapVenueAdapter, MonadTestnetRegistry} from "./MonadTestnetRegistry.sol";
import {SafeToken} from "./SafeToken.sol";
import {MeraMandate} from "./MeraMandate.sol";

/// @notice Owner-controlled USDC/WMON vault. The executor can only submit swaps
/// that fit one live, owner-signed mandate; it cannot withdraw or make arbitrary calls.
contract MoeaziTestnetVault {
    using SafeToken for address;

    uint64 public constant MAX_MANDATE_LIFETIME = 7 days;
    uint8 public constant MAX_MANDATE_ADAPTERS = 4;

    address public immutable owner;
    address public immutable usdc = MonadTestnetRegistry.USDC;
    address public immutable wmon = MonadTestnetRegistry.WMON;
    address public executor;
    uint256 public mandateNonce;
    uint256 public activeMandateNonce;
    bytes32 public activeMandateHash;
    bool public mandateActive;
    bool public stopped;

    mapping(address => bool) public adapterAllowed;
    mapping(address => bool) private mandateAdapterAllowed;
    mapping(uint256 => uint256) private _mandateUsed;
    mapping(bytes32 => bool) public executedOrder;
    address[] private _activeAdapters;
    address public activeTokenIn;
    address public activeTokenOut;
    uint256 public activeMaxInputPerTrade;
    uint256 public activeMaxTotalInput;
    uint64 public activeValidAfter;
    uint64 public activeExpiresAt;
    uint256 private _entered;

    event Deposited(address indexed owner, address indexed asset, uint256 amount);
    event Withdrawn(address indexed owner, address indexed asset, uint256 amount);
    event ExecutorChanged(address indexed executor);
    event AdapterPermissionChanged(address indexed adapter, bool allowed);
    event MandateAuthorized(bytes32 indexed digest, uint256 indexed nonce, address tokenIn,
        address tokenOut, uint256 maxInputPerTrade, uint256 maxTotalInput, uint64 expiresAt);
    event MandateRevoked(uint256 indexed nonce);
    event TradingStopped(address indexed owner);
    event TradingResumed(address indexed owner);
    event MandatedSwap(bytes32 indexed orderId, address indexed adapter, address indexed tokenIn,
        address tokenOut, uint256 amountIn, uint256 amountOut, uint256 cumulativeInput);

    error WrongChain();
    error Unauthorized();
    error InvalidAsset();
    error InvalidAmount();
    error TransferFailed();
    error InvalidMandate();
    error InvalidSignature();
    error MandateNotActive();
    error AdapterNotAllowed();
    error CapExceeded();
    error SlippageExceeded();
    error Reentrant();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyExecutor() {
        if (executor == address(0) || msg.sender != executor) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_entered != 0) revert Reentrant();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(address owner_, address executor_, address[] memory initialAdapters) {
        if (block.chainid != MonadTestnetRegistry.CHAIN_ID) revert WrongChain();
        if (owner_ == address(0) || initialAdapters.length > 16) revert InvalidMandate();
        owner = owner_;
        executor = executor_;
        for (uint256 i; i < initialAdapters.length; ++i) {
            address adapter = initialAdapters[i];
            if (adapter == address(0) || adapter.code.length == 0 || adapterAllowed[adapter]) {
                revert InvalidMandate();
            }
            adapterAllowed[adapter] = true;
            emit AdapterPermissionChanged(adapter, true);
        }
    }

    function deposit(address asset, uint256 amount) external nonReentrant onlyOwner {
        _requireAsset(asset);
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(owner, address(this), amount);
        if (asset.balanceOf(address(this)) != beforeBalance + amount) revert TransferFailed();
        emit Deposited(owner, asset, amount);
    }

    function withdraw(address asset, uint256 amount) external nonReentrant onlyOwner {
        _requireAsset(asset);
        if (amount == 0 || asset.balanceOf(address(this)) < amount) revert InvalidAmount();
        asset.safeTransfer(owner, amount);
        emit Withdrawn(owner, asset, amount);
    }

    function setExecutor(address executor_) external onlyOwner {
        executor = executor_;
        emit ExecutorChanged(executor_);
    }

    function setAdapterAllowed(address adapter, bool allowed) external onlyOwner {
        if (adapter == address(0) || (allowed && adapter.code.length == 0)) revert InvalidMandate();
        adapterAllowed[adapter] = allowed;
        emit AdapterPermissionChanged(adapter, allowed);
    }

    function mandateDigest(MeraMandate.Mandate calldata mandate) external view returns (bytes32) {
        return MeraMandate.digest(mandate, address(this));
    }

    function authorizeMandate(MeraMandate.Mandate calldata mandate, bytes calldata signature)
        external nonReentrant returns (bytes32 digest)
    {
        _validateMandate(mandate);
        digest = MeraMandate.digest(mandate, address(this));
        if (!MeraMandate.isOwnerSignature(owner, digest, signature)) revert InvalidSignature();

        mandateActive = true;
        activeMandateHash = digest;
        activeMandateNonce = mandate.nonce;
        activeTokenIn = mandate.tokenIn;
        activeTokenOut = mandate.tokenOut;
        activeMaxInputPerTrade = mandate.maxInputPerTrade;
        activeMaxTotalInput = mandate.maxTotalInput;
        activeValidAfter = mandate.validAfter;
        activeExpiresAt = mandate.expiresAt;
        ++mandateNonce;
        for (uint256 i; i < mandate.allowedAdapters.length; ++i) {
            address adapter = mandate.allowedAdapters[i];
            mandateAdapterAllowed[adapter] = true;
            _activeAdapters.push(adapter);
        }
        emit MandateAuthorized(digest, mandate.nonce, mandate.tokenIn, mandate.tokenOut,
            mandate.maxInputPerTrade, mandate.maxTotalInput, mandate.expiresAt);
    }

    function revokeMandate() external onlyOwner {
        _revokeMandate();
    }

    function stop() external onlyOwner {
        stopped = true;
        _revokeMandate();
        emit TradingStopped(owner);
    }

    function resume() external onlyOwner {
        stopped = false;
        emit TradingResumed(owner);
    }

    function isMandateActive(bytes32 digest) external view returns (bool) {
        return mandateActive && !stopped && digest == activeMandateHash
            && block.timestamp >= activeValidAfter && block.timestamp < activeExpiresAt;
    }

    function activeMandateUsed() external view returns (uint256) {
        return _mandateUsed[activeMandateNonce];
    }

    function mandateUsed(uint256 nonce) external view returns (uint256) {
        return _mandateUsed[nonce];
    }

    function activeAdapters() external view returns (address[] memory) {
        return _activeAdapters;
    }

    function executeMandatedSwap(bytes32 orderId, address adapter, uint256 amountIn,
        uint256 minAmountOut, bytes calldata venueData)
        external nonReentrant onlyExecutor returns (uint256 amountOut)
    {
        if (!mandateActive || stopped || block.timestamp < activeValidAfter
            || block.timestamp >= activeExpiresAt) revert MandateNotActive();
        if (orderId == bytes32(0) || executedOrder[orderId]) revert InvalidMandate();
        if (!adapterAllowed[adapter] || !mandateAdapterAllowed[adapter]) revert AdapterNotAllowed();
        uint256 used = _mandateUsed[activeMandateNonce];
        if (amountIn == 0 || amountIn > activeMaxInputPerTrade
            || used > activeMaxTotalInput || amountIn > activeMaxTotalInput - used) revert CapExceeded();
        if (minAmountOut == 0) revert InvalidAmount();

        executedOrder[orderId] = true;
        _mandateUsed[activeMandateNonce] = used + amountIn;
        amountOut = _swapAndVerify(adapter, amountIn, minAmountOut, venueData);
        emit MandatedSwap(orderId, adapter, activeTokenIn, activeTokenOut,
            amountIn, amountOut, used + amountIn);
    }

    function _swapAndVerify(address adapter, uint256 amountIn, uint256 minAmountOut, bytes calldata venueData)
        private returns (uint256 amountOut)
    {
        address tokenIn = activeTokenIn;
        address tokenOut = activeTokenOut;
        uint256 beforeIn = tokenIn.balanceOf(address(this));
        uint256 beforeOut = tokenOut.balanceOf(address(this));
        tokenIn.safeApprove(adapter, 0);
        tokenIn.safeApprove(adapter, amountIn);
        uint256 reportedOut = ISwapVenueAdapter(adapter).swap(
            tokenIn, tokenOut, amountIn, minAmountOut, venueData
        );
        tokenIn.safeApprove(adapter, 0);
        uint256 afterIn = tokenIn.balanceOf(address(this));
        uint256 afterOut = tokenOut.balanceOf(address(this));
        if (beforeIn < afterIn || beforeIn - afterIn != amountIn) revert TransferFailed();
        if (afterOut < beforeOut) revert TransferFailed();
        amountOut = afterOut - beforeOut;
        if (amountOut < minAmountOut || reportedOut != amountOut) revert SlippageExceeded();
    }

    function _validateMandate(MeraMandate.Mandate calldata mandate) private view {
        if (stopped || mandateActive || mandate.chainId != MonadTestnetRegistry.CHAIN_ID
            || mandate.vault != address(this) || mandate.nonce != mandateNonce
            || !_validPair(mandate.tokenIn, mandate.tokenOut)
            || mandate.maxInputPerTrade == 0 || mandate.maxTotalInput < mandate.maxInputPerTrade
            || mandate.allowedAdapters.length == 0 || mandate.allowedAdapters.length > MAX_MANDATE_ADAPTERS
            || mandate.expiresAt <= block.timestamp || mandate.expiresAt <= mandate.validAfter
            || mandate.expiresAt - mandate.validAfter > MAX_MANDATE_LIFETIME
            || mandate.expiresAt > block.timestamp + MAX_MANDATE_LIFETIME) revert InvalidMandate();
        for (uint256 i; i < mandate.allowedAdapters.length; ++i) {
            address adapter = mandate.allowedAdapters[i];
            if (!adapterAllowed[adapter] || adapter.code.length == 0 || mandateAdapterAllowed[adapter]) {
                revert InvalidMandate();
            }
            for (uint256 j; j < i; ++j) if (mandate.allowedAdapters[j] == adapter) revert InvalidMandate();
        }
    }

    function _revokeMandate() private {
        uint256 oldNonce = activeMandateNonce;
        for (uint256 i; i < _activeAdapters.length; ++i) mandateAdapterAllowed[_activeAdapters[i]] = false;
        delete _activeAdapters;
        mandateActive = false;
        activeMandateHash = bytes32(0);
        activeTokenIn = address(0);
        activeTokenOut = address(0);
        activeMaxInputPerTrade = 0;
        activeMaxTotalInput = 0;
        activeValidAfter = 0;
        activeExpiresAt = 0;
        ++mandateNonce;
        emit MandateRevoked(oldNonce);
    }

    function _requireAsset(address asset) private view {
        if (asset != usdc && asset != wmon) revert InvalidAsset();
    }

    function _validPair(address tokenIn, address tokenOut) private view returns (bool) {
        return (tokenIn == usdc && tokenOut == wmon) || (tokenIn == wmon && tokenOut == usdc);
    }
}
