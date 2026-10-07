// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MonadTestnetRegistry} from "../MonadTestnetRegistry.sol";
import {SafeToken} from "../SafeToken.sol";
import {IAutonomyPairPool} from "./AutonomyTypes.sol";

abstract contract AutonomousVaultBase {
    using SafeToken for address;
    uint256 private constant BPS = 10_000;
    uint64 public constant MIN_DURATION = 10 minutes;
    uint64 public constant MAX_DURATION = 120 minutes;
    uint256 public constant MIN_FUNDING = 100_000;
    uint256 public constant MAX_FUNDING = 10_000_000;

    enum SettlementStatus { Uninitialized, Active, Completed, Incomplete, EmergencyRecovered }

    struct SwapResult {
        bool success;
        uint256 amountOut;
        uint256 expectedAmountOut;
        uint256 quotedAmountOut;
        uint256 minAmountOut;
    }

    address public immutable owner;
    address public immutable executor;
    address public immutable factory;
    address public immutable usdc;
    address[3] internal _tokens;
    address[3] internal _pools;
    uint256 public fundedAmount;
    uint256 public mandateNonce;
    bytes32 public mandateHash;
    uint64 public activatedAt;
    uint64 public expiresAt;
    uint16 public buySlippageBps;
    uint16 public sellSlippageBps;
    uint8 public completedCycles;
    uint8 public positionTokenIndex;
    uint256 public positionAmount;
    uint256 public positionUsdcCost;
    bool public positionOpen;
    SettlementStatus public settlementStatus;
    mapping(bytes32 => bool) public executedOrder;
    uint256 private _entered;

    error WrongChain();
    error Unauthorized();
    error InvalidAmount();
    error InvalidOrder();
    error MandateInactive();
    error PositionAlreadyOpen();
    error PositionNotOpen();
    error CycleLimitReached();
    error SwapUnavailable();
    error StaleQuote();
    error TransferFailed();
    error Reentrant();

    event Enrolled(address indexed owner, address indexed vault, uint256 fundingAmount,
        uint64 durationSeconds, uint64 activatedAt, uint64 expiresAt, uint256 nonce, bytes32 mandateHash);
    event BuyExecuted(bytes32 indexed orderId, uint8 indexed tokenIndex, uint256 amountIn,
        uint256 amountOut, uint256 expectedAmountOut, uint256 quotedAmountOut, uint256 minAmountOut);
    event SellExecuted(bytes32 indexed orderId, uint8 indexed tokenIndex, uint256 amountIn,
        uint256 amountOut, uint256 expectedAmountOut, uint256 quotedAmountOut, uint256 minAmountOut);
    event CycleCompleted(uint8 indexed completedCycles, uint8 indexed tokenIndex, uint256 usdcSpent,
        uint256 usdcReceived, int256 realizedProfitLoss, uint256 usdcBalance);
    event AssetReturned(address indexed asset, uint256 amount);
    event Settled(address indexed owner, SettlementStatus indexed status, uint256 usdcReturned,
        uint8 unsoldTokenMask, uint8 completedCycles);

    modifier onlyFactory() {
        if (msg.sender != factory) revert Unauthorized();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_entered != 0) revert Reentrant();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(address owner_, address executor_, address factory_, address usdc_,
        address[3] memory tokens_, address[3] memory pools_)
    {
        if (block.chainid != MonadTestnetRegistry.CHAIN_ID) revert WrongChain();
        if (owner_ == address(0) || executor_ == address(0) || factory_ == address(0)
            || usdc_ != MonadTestnetRegistry.USDC) revert InvalidAmount();
        owner = owner_;
        executor = executor_;
        factory = factory_;
        usdc = usdc_;
        _tokens = tokens_;
        _pools = pools_;
    }

    function tokenAt(uint8 index) external view returns (address) {
        if (index >= 3) revert InvalidAmount();
        return _tokens[index];
    }

    function poolAt(uint8 index) external view returns (address) {
        if (index >= 3) revert InvalidAmount();
        return _pools[index];
    }

    function _trySwap(address tokenIn, address tokenOut, address pool, uint256 amountIn,
        uint256 expectedAmountOut, uint16 slippageBps) internal returns (SwapResult memory result)
    {
        bool quoteAvailable;
        (result.quotedAmountOut, quoteAvailable) = _readQuote(pool, tokenIn, tokenOut, amountIn);
        if (!quoteAvailable) return result;
        if (expectedAmountOut == 0) revert StaleQuote();
        result.expectedAmountOut = expectedAmountOut;
        if (expectedAmountOut < result.quotedAmountOut * (BPS - slippageBps) / BPS
            || result.quotedAmountOut < expectedAmountOut * (BPS - slippageBps) / BPS) {
            revert StaleQuote();
        }
        result.minAmountOut = expectedAmountOut * (BPS - slippageBps) / BPS;
        if (result.minAmountOut == 0 || result.quotedAmountOut < result.minAmountOut) revert StaleQuote();
        (result.success, result.amountOut) = _performSwap(
            tokenIn, tokenOut, pool, amountIn, result.minAmountOut
        );
    }

    function _readQuote(address pool, address tokenIn, address tokenOut, uint256 amountIn)
        private view returns (uint256 amountOut, bool available)
    {
        (bool ok, bytes memory data) = pool.staticcall(abi.encodeCall(
            IAutonomyPairPool.quoteExactInput, (tokenIn, tokenOut, amountIn)
        ));
        if (!ok || data.length < 64) return (0, false);
        return abi.decode(data, (uint256, bool));
    }

    function _performSwap(address tokenIn, address tokenOut, address pool, uint256 amountIn,
        uint256 minAmountOut) private returns (bool success, uint256 amountOut)
    {
        uint256 beforeIn = tokenIn.balanceOf(address(this));
        uint256 beforeOut = tokenOut.balanceOf(address(this));
        tokenIn.safeApprove(pool, 0);
        tokenIn.safeApprove(pool, amountIn);
        (bool ok, bytes memory data) = pool.call(abi.encodeCall(
            IAutonomyPairPool.swap, (tokenIn, tokenOut, amountIn, minAmountOut)
        ));
        if (!ok) {
            tokenIn.safeApprove(pool, 0);
            return (false, 0);
        }
        if (data.length < 32) revert TransferFailed();
        uint256 reportedOut = abi.decode(data, (uint256));
        tokenIn.safeApprove(pool, 0);
        uint256 afterIn = tokenIn.balanceOf(address(this));
        uint256 afterOut = tokenOut.balanceOf(address(this));
        if (beforeIn < afterIn || beforeIn - afterIn != amountIn || afterOut < beforeOut) revert TransferFailed();
        amountOut = afterOut - beforeOut;
        if (reportedOut != amountOut || amountOut < minAmountOut) revert TransferFailed();
        success = true;
    }

    function _closeCycle(bytes32 orderId, uint8 index, uint256 tokenAmount, uint256 usdcCost,
        SwapResult memory result) internal
    {
        positionOpen = false;
        positionAmount = 0;
        positionUsdcCost = 0;
        ++completedCycles;
        int256 pnl = result.amountOut >= usdcCost
            ? int256(result.amountOut - usdcCost) : -int256(usdcCost - result.amountOut);
        emit SellExecuted(orderId, index, tokenAmount, result.amountOut,
            result.expectedAmountOut, result.quotedAmountOut, result.minAmountOut);
        emit CycleCompleted(completedCycles, index, usdcCost, result.amountOut,
            pnl, usdc.balanceOf(address(this)));
    }

    function _finish(SettlementStatus status) internal {
        if (settlementStatus == SettlementStatus.Uninitialized) revert MandateInactive();
        positionOpen = false;
        settlementStatus = status;
        uint256 usdcAmount = usdc.balanceOf(address(this));
        if (usdcAmount != 0) {
            usdc.safeTransfer(owner, usdcAmount);
            emit AssetReturned(usdc, usdcAmount);
        }
        uint8 unsoldMask;
        for (uint8 i; i < 3; ++i) {
            uint256 tokenAmount = _tokens[i].balanceOf(address(this));
            if (tokenAmount != 0) {
                if (status == SettlementStatus.Incomplete) unsoldMask |= uint8(1 << i);
                _tokens[i].safeTransfer(owner, tokenAmount);
                emit AssetReturned(_tokens[i], tokenAmount);
            }
        }
        emit Settled(owner, status, usdcAmount, unsoldMask, completedCycles);
    }

    function _claimOrder(bytes32 orderId) internal {
        if (orderId == bytes32(0) || executedOrder[orderId]) revert InvalidOrder();
        executedOrder[orderId] = true;
    }

    function _requireActive() internal view {
        if (settlementStatus != SettlementStatus.Active) revert MandateInactive();
    }
}
