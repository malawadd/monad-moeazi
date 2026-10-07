// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MonadTestnetRegistry} from "../MonadTestnetRegistry.sol";
import {SafeToken} from "../SafeToken.sol";
import {AutonomyTypes, ICircleReceiveAuthorization} from "../autonomy/AutonomyTypes.sol";
import {PerpMandate} from "./PerpMandate.sol";
import {IPerpClearinghouse, IPerpFactoryTerminal} from "./PerpTypes.sol";

/// @notice Per-owner USDC custody and mandate checks for synthetic testnet perp positions.
contract PerpVault {
    using SafeToken for address;
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("Moeazi Monad Testnet Perp Vault");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant STOP_TYPEHASH = keccak256(
        "Stop(address vault,address owner,uint256 nonce,uint64 deadline)"
    );
    uint64 public constant STOP_WINDOW = 5 minutes;

    enum RunStatus { Uninitialized, Active, Stopped, Expired }
    address public immutable owner;
    address public immutable executor;
    address public immutable factory;
    address public immutable clearinghouse;
    address public immutable usdc;
    address[3] private _tokens;
    address[3] private _pools;
    uint256 public fundedAmount;
    uint256 public mandateNonce;
    uint256 public stopNonce;
    bytes32 public mandateHash;
    uint64 public activatedAt;
    uint64 public expiresAt;
    RunStatus public status;
    mapping(bytes32 => bool) public usedOrderId;
    uint256 private _entered;

    error Unauthorized(); error WrongChain(); error InvalidMandate(); error InvalidAuthorization();
    error InvalidSignature(); error AlreadyInitialized(); error RunInactive(); error InvalidOrder();
    error InvalidAmount(); error TransferFailed(); error Reentrant();

    event PerpEnrolled(address indexed owner, address indexed vault, uint256 fundingAmount,
        uint64 activatedAt, uint64 expiresAt, uint256 nonce, bytes32 mandateHash);
    event SettlementReturned(address indexed owner, uint256 amountUsdc, RunStatus status);
    event Stopped(address indexed owner, uint256 indexed nonce, uint256 returnedUsdc);
    event RunExpired(address indexed owner, uint256 returnedUsdc);

    modifier onlyFactory() { if (msg.sender != factory) revert Unauthorized(); _; }
    modifier onlyExecutor() { if (msg.sender != executor) revert Unauthorized(); _; }
    modifier activeRun() { if (status != RunStatus.Active) revert RunInactive(); _; }
    modifier nonReentrant() {
        if (_entered != 0) revert Reentrant(); _entered = 1; _; _entered = 0;
    }

    constructor(address owner_, address executor_, address factory_, address clearinghouse_, address usdc_,
        address[3] memory tokens_, address[3] memory pools_)
    {
        if (block.chainid != MonadTestnetRegistry.CHAIN_ID) revert WrongChain();
        if (owner_ == address(0) || executor_ == address(0) || factory_ == address(0)
            || clearinghouse_.code.length == 0 || usdc_ != MonadTestnetRegistry.USDC) revert InvalidMandate();
        owner = owner_; executor = executor_; factory = factory_;
        clearinghouse = clearinghouse_; usdc = usdc_; _tokens = tokens_; _pools = pools_;
    }

    function initializeAndFund(AutonomyTypes.CircleAuthorization calldata auth,
        PerpMandate.Mandate calldata mandate, bytes calldata signature, uint256 expectedNonce)
        external onlyFactory nonReentrant
    {
        if (status != RunStatus.Uninitialized) revert AlreadyInitialized();
        _validateMandate(mandate, expectedNonce);
        _validateAuthorization(auth, mandate.fundingAmount, mandate.setupDeadline);
        bytes32 digest = PerpMandate.digest(mandate, factory);
        if (!PerpMandate.isOwnerSignature(owner, digest, signature)) revert InvalidSignature();
        _receiveFunding(auth, mandate.fundingAmount);
        fundedAmount = mandate.fundingAmount; mandateNonce = mandate.nonce; mandateHash = digest;
        activatedAt = uint64(block.timestamp); expiresAt = activatedAt + mandate.durationSeconds;
        status = RunStatus.Active;
        IPerpClearinghouse(clearinghouse).activateVault(expiresAt);
        emit PerpEnrolled(owner, address(this), fundedAmount, activatedAt, expiresAt, mandate.nonce, digest);
    }

    function _validateMandate(PerpMandate.Mandate calldata m, uint256 expectedNonce) private view {
        if (m.chainId != MonadTestnetRegistry.CHAIN_ID || m.owner != owner || m.vault != address(this)
            || m.usdc != usdc || m.clearinghouse != clearinghouse || m.executor != executor
            || m.nonce != expectedNonce || m.policyVersion != 1 || m.fundingAmount < 100_000
            || m.fundingAmount > 10_000_000 || m.durationSeconds < 10 minutes
            || m.durationSeconds > 120 minutes || m.setupDeadline < block.timestamp
            || m.setupDeadline > block.timestamp + STOP_WINDOW) revert InvalidMandate();
        for (uint8 i; i < 3; ++i) if (m.tokens[i] != _tokens[i] || m.pools[i] != _pools[i])
            revert InvalidMandate();
    }

    function _validateAuthorization(AutonomyTypes.CircleAuthorization calldata auth,
        uint256 amount, uint64 setupDeadline) private view
    {
        if (auth.from != owner || auth.to != address(this) || auth.value != amount
            || auth.validAfter >= block.timestamp || auth.validBefore <= block.timestamp
            || auth.validBefore > setupDeadline || (auth.v != 27 && auth.v != 28)) revert InvalidAuthorization();
    }

    function _receiveFunding(AutonomyTypes.CircleAuthorization calldata auth, uint256 amount) private {
        uint256 beforeBalance = usdc.balanceOf(address(this));
        ICircleReceiveAuthorization(usdc).receiveWithAuthorization(auth.from, auth.to, auth.value,
            auth.validAfter, auth.validBefore, auth.nonce, auth.v, auth.r, auth.s);
        if (usdc.balanceOf(address(this)) != beforeBalance + amount) revert TransferFailed();
    }

    function tokenAt(uint8 index) external view returns (address) { if (index >= 3) revert InvalidAmount(); return _tokens[index]; }
    function poolAt(uint8 index) external view returns (address) { if (index >= 3) revert InvalidAmount(); return _pools[index]; }
    function availableUsdc() external view returns (uint256) { return usdc.balanceOf(address(this)); }

    function stopDigest(uint256 nonce, uint64 deadline) external view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(
            DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)
        ));
        bytes32 body = keccak256(abi.encode(STOP_TYPEHASH, address(this), owner, nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", domain, body));
    }

    function submitEntry(bytes32 orderId, uint8 marketIndex, bool isLong, uint8 leverage,
        uint256 marginUsdc, uint256 limitPriceWad, uint256 expectedPriceWad, uint64 validUntil)
        external onlyExecutor activeRun nonReentrant
    {
        _beforeExpiry(); _claim(orderId);
        if (marketIndex >= 3 || leverage < 1 || leverage > 10 || marginUsdc == 0
            || marginUsdc > fundedAmount || marginUsdc > usdc.balanceOf(address(this))) revert InvalidAmount();
        _sendCollateral(marginUsdc);
        IPerpClearinghouse(clearinghouse).submitEntry(orderId, marketIndex, isLong, leverage,
            marginUsdc, limitPriceWad, expectedPriceWad, validUntil);
    }

    function fillLimit(bytes32 orderId) external onlyExecutor activeRun nonReentrant {
        _beforeExpiry(); IPerpClearinghouse(clearinghouse).fillEntry(orderId);
    }

    function amendLimit(bytes32 orderId, uint256 limitPriceWad, uint64 goodUntil)
        external onlyExecutor activeRun nonReentrant
    { _beforeExpiry(); IPerpClearinghouse(clearinghouse).amendEntry(orderId, limitPriceWad, goodUntil); }

    function cancelPending(bytes32 orderId) external onlyExecutor activeRun nonReentrant {
        _beforeExpiry();
        _requirePending(orderId); IPerpClearinghouse(clearinghouse).cancelEntry();
    }

    function increaseSize(bytes32 orderId, uint256 additionalMarginUsdc,
        uint256 expectedPriceWad, uint64 validUntil)
        external onlyExecutor activeRun nonReentrant
    {
        _beforeExpiry(); _claim(orderId); _fundPosition(additionalMarginUsdc);
        IPerpClearinghouse(clearinghouse).increaseSize(
            orderId, additionalMarginUsdc, expectedPriceWad, validUntil
        );
    }

    function reduceSize(bytes32 orderId, uint256 closeSizeWad, uint256 expectedPriceWad, uint64 validUntil)
        external onlyExecutor activeRun nonReentrant
    {
        _beforeExpiry();
        _claim(orderId); IPerpClearinghouse(clearinghouse).reduceSize(
            orderId, closeSizeWad, expectedPriceWad, validUntil
        );
    }

    function addMargin(bytes32 orderId, uint256 amountUsdc, uint256 expectedPriceWad, uint64 validUntil)
        external onlyExecutor activeRun nonReentrant
    {
        _beforeExpiry(); _claim(orderId); _fundPosition(amountUsdc);
        IPerpClearinghouse(clearinghouse).addMargin(orderId, amountUsdc, expectedPriceWad, validUntil);
    }

    function removeMargin(bytes32 orderId, uint256 amountUsdc, uint256 expectedPriceWad, uint64 validUntil)
        external onlyExecutor activeRun nonReentrant
    {
        _beforeExpiry();
        _claim(orderId); IPerpClearinghouse(clearinghouse).removeMargin(
            orderId, amountUsdc, expectedPriceWad, validUntil
        );
    }

    function setTriggers(bytes32 orderId, uint256 takeProfitWad, uint256 stopLossWad)
        external onlyExecutor activeRun
    { _beforeExpiry(); _claim(orderId); IPerpClearinghouse(clearinghouse).setTriggers(orderId, takeProfitWad, stopLossWad); }

    function accrueFunding(bytes32 orderId) external onlyExecutor activeRun {
        _beforeExpiry(); _claim(orderId); IPerpClearinghouse(clearinghouse).accrueFunding(orderId);
    }

    function closePosition(bytes32 orderId, uint256 expectedPriceWad, uint64 validUntil)
        external onlyExecutor activeRun nonReentrant
    {
        _beforeExpiry(); _claim(orderId);
        IPerpClearinghouse(clearinghouse).closePosition(orderId, 0, expectedPriceWad, validUntil);
    }

    function executeTrigger(bytes32 orderId, uint256 expectedPriceWad, uint64 validUntil)
        external onlyExecutor activeRun nonReentrant
    {
        _beforeExpiry(); _claim(orderId);
        IPerpClearinghouse(clearinghouse).executeTrigger(orderId, expectedPriceWad, validUntil);
    }

    function liquidate(bytes32 orderId) external onlyExecutor activeRun nonReentrant {
        _beforeExpiry(); _claim(orderId); IPerpClearinghouse(clearinghouse).liquidate(orderId);
    }

    function settleExpired(bytes32 orderId) external onlyExecutor activeRun nonReentrant {
        if (block.timestamp < expiresAt) revert RunInactive();
        _claim(orderId); _cancelIfPending();
        (bool open,,,,,,,,,,,) = IPerpClearinghouse(clearinghouse).position(address(this));
        if (open) IPerpClearinghouse(clearinghouse).closePosition(orderId, 4, 0, 0);
        _finish(RunStatus.Expired, false);
    }

    function stopWithSignature(uint256 nonce, uint64 deadline, bytes calldata signature)
        external onlyExecutor activeRun nonReentrant
    {
        if (nonce != stopNonce || deadline < block.timestamp || deadline > block.timestamp + STOP_WINDOW)
            revert InvalidSignature();
        bytes32 digest = this.stopDigest(nonce, deadline);
        if (!PerpMandate.isOwnerSignature(owner, digest, signature)) revert InvalidSignature();
        stopNonce = nonce + 1;
        _cancelIfPending();
        (bool open,,,,,,,,,,,) = IPerpClearinghouse(clearinghouse).position(address(this));
        if (open) IPerpClearinghouse(clearinghouse).closePosition(
            keccak256(abi.encodePacked(address(this), "stop", nonce)), 5, 0, 0
        );
        uint256 returned = _finish(RunStatus.Stopped, true);
        emit Stopped(owner, nonce, returned);
    }

    function _finish(RunStatus terminal, bool stopped) private returns (uint256 amount) {
        status = terminal;
        amount = usdc.balanceOf(address(this));
        if (amount != 0) usdc.safeTransfer(owner, amount);
        emit SettlementReturned(owner, amount, terminal);
        if (stopped) IPerpFactoryTerminal(factory).onRunTerminal(owner);
        else { emit RunExpired(owner, amount); IPerpFactoryTerminal(factory).onRunTerminal(owner); }
    }

    function _sendCollateral(uint256 amount) private {
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransfer(clearinghouse, amount);
        if (beforeBalance - usdc.balanceOf(address(this)) != amount) revert TransferFailed();
    }

    function _fundPosition(uint256 amount) private {
        uint256 current = IPerpClearinghouse(clearinghouse).currentMargin(address(this));
        if (amount == 0 || amount > fundedAmount || current + amount > fundedAmount
            || amount > usdc.balanceOf(address(this))) revert InvalidAmount();
        _sendCollateral(amount);
    }

    function _cancelIfPending() private {
        (bytes32 pending,,,,,,) = IPerpClearinghouse(clearinghouse).pendingOrder(address(this));
        if (pending != bytes32(0)) IPerpClearinghouse(clearinghouse).cancelEntry();
    }

    function _requirePending(bytes32 id) private view {
        (bytes32 pending,,,,,,) = IPerpClearinghouse(clearinghouse).pendingOrder(address(this));
        if (pending == bytes32(0) || pending != id) revert InvalidOrder();
    }

    function _beforeExpiry() private view { if (block.timestamp >= expiresAt) revert RunInactive(); }
    function _claim(bytes32 orderId) private {
        if (orderId == bytes32(0) || usedOrderId[orderId]) revert InvalidOrder();
        usedOrderId[orderId] = true;
    }
}
