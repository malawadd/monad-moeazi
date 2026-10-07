// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MonadTestnetRegistry} from "../MonadTestnetRegistry.sol";
import {SafeToken} from "../SafeToken.sol";
import {AutonomyTypes, ICircleReceiveAuthorization} from "./AutonomyTypes.sol";
import {AutonomyMandate} from "./AutonomyMandate.sol";
import {AutonomousVaultBase} from "./AutonomousVaultBase.sol";

/// @notice One Mera-approved, operator-executed position with owner-only recovery.
contract MoeaziAutonomousVault is AutonomousVaultBase {
    using SafeToken for address;

    error AlreadyInitialized();
    error InvalidMandate();
    error InvalidAuthorization();
    error InvalidSignature();

    constructor(address owner_, address executor_, address factory_, address usdc_,
        address[3] memory tokens_, address[3] memory pools_)
        AutonomousVaultBase(owner_, executor_, factory_, usdc_, tokens_, pools_) {}

    function initializeAndFund(
        AutonomyTypes.CircleAuthorization calldata authorization,
        AutonomyMandate.StrategyMandate calldata mandate,
        bytes calldata signature,
        uint256 expectedNonce
    ) external onlyFactory nonReentrant {
        if (settlementStatus != SettlementStatus.Uninitialized) revert AlreadyInitialized();
        _validateMandate(authorization, mandate, expectedNonce);
        bytes32 digest = AutonomyMandate.digest(mandate, address(this));
        if (!AutonomyMandate.isOwnerSignature(owner, digest, signature)) revert InvalidSignature();
        _receiveFunding(authorization, mandate.fundingAmount);
        mandateNonce = mandate.nonce;
        mandateHash = digest;
        fundedAmount = mandate.fundingAmount;
        buySlippageBps = mandate.buySlippageBps;
        sellSlippageBps = mandate.sellSlippageBps;
        activatedAt = uint64(block.timestamp);
        expiresAt = uint64(block.timestamp + mandate.durationSeconds);
        settlementStatus = SettlementStatus.Active;
        emit Enrolled(owner, address(this), fundedAmount, mandate.durationSeconds,
            activatedAt, expiresAt, mandate.nonce, digest);
    }

    function buy(bytes32 orderId, uint8 tokenIndex, uint256 amountIn, uint256 expectedAmountOut)
        external onlyExecutor nonReentrant returns (uint256 amountOut)
    {
        _requireActive();
        if (block.timestamp >= expiresAt) revert MandateInactive();
        if (positionOpen) revert PositionAlreadyOpen();
        if (completedCycles >= 3) revert CycleLimitReached();
        if (tokenIndex >= 3 || amountIn == 0 || amountIn > fundedAmount
            || amountIn > usdc.balanceOf(address(this))) revert InvalidAmount();
        _claimOrder(orderId);
        SwapResult memory result = _trySwap(
            usdc, _tokens[tokenIndex], _pools[tokenIndex], amountIn, expectedAmountOut, buySlippageBps
        );
        if (!result.success) revert SwapUnavailable();
        amountOut = result.amountOut;
        positionOpen = true;
        positionTokenIndex = tokenIndex;
        positionAmount = amountOut;
        positionUsdcCost = amountIn;
        emit BuyExecuted(orderId, tokenIndex, amountIn, amountOut,
            result.expectedAmountOut, result.quotedAmountOut, result.minAmountOut);
    }

    function sell(bytes32 orderId, uint256 expectedAmountOut)
        external onlyExecutor nonReentrant returns (uint256 amountOut)
    {
        _requireActive();
        if (!positionOpen) revert PositionNotOpen();
        _claimOrder(orderId);
        uint8 index = positionTokenIndex;
        uint256 tokenAmount = positionAmount;
        uint256 usdcCost = positionUsdcCost;
        SwapResult memory result = _trySwap(
            _tokens[index], usdc, _pools[index], tokenAmount, expectedAmountOut, sellSlippageBps
        );
        if (!result.success) {
            if (block.timestamp >= expiresAt) {
                _finish(SettlementStatus.Incomplete);
                return 0;
            }
            revert SwapUnavailable();
        }
        amountOut = result.amountOut;
        _closeCycle(orderId, index, tokenAmount, usdcCost, result);
        if (completedCycles == 3 || block.timestamp >= expiresAt) _finish(SettlementStatus.Completed);
    }

    function settleExpired(bytes32 sellOrderId, uint256 expectedAmountOut) external onlyExecutor nonReentrant {
        _requireActive();
        if (block.timestamp < expiresAt) revert MandateInactive();
        if (!positionOpen) {
            _finish(SettlementStatus.Completed);
            return;
        }
        _claimOrder(sellOrderId);
        uint8 index = positionTokenIndex;
        uint256 tokenAmount = positionAmount;
        uint256 usdcCost = positionUsdcCost;
        SwapResult memory result = _trySwap(
            _tokens[index], usdc, _pools[index], tokenAmount, expectedAmountOut, sellSlippageBps
        );
        if (!result.success) {
            _finish(SettlementStatus.Incomplete);
            return;
        }
        _closeCycle(sellOrderId, index, tokenAmount, usdcCost, result);
        _finish(SettlementStatus.Completed);
    }

    function emergencyRecover() external onlyOwner nonReentrant {
        _requireActive();
        _finish(SettlementStatus.EmergencyRecovered);
    }

    function _validateMandate(AutonomyTypes.CircleAuthorization calldata authorization,
        AutonomyMandate.StrategyMandate calldata mandate, uint256 expectedNonce) private view
    {
        if (mandate.chainId != MonadTestnetRegistry.CHAIN_ID || mandate.owner != owner
            || mandate.vault != address(this) || mandate.usdc != usdc || mandate.nonce != expectedNonce
            || mandate.fundingAmount < MIN_FUNDING || mandate.fundingAmount > MAX_FUNDING
            || mandate.durationSeconds < MIN_DURATION || mandate.durationSeconds > MAX_DURATION
            || mandate.startBy < block.timestamp || mandate.startBy > block.timestamp + 5 minutes
            || mandate.maxCycles != 3 || mandate.buySlippageBps > 500 || mandate.sellSlippageBps > 500) {
            revert InvalidMandate();
        }
        for (uint8 i; i < 3; ++i) {
            if (mandate.tokens[i] != _tokens[i] || mandate.pools[i] != _pools[i]) revert InvalidMandate();
        }
        if (authorization.from != owner || authorization.to != address(this)
            || authorization.value != mandate.fundingAmount || authorization.validAfter >= block.timestamp
            || authorization.validBefore <= block.timestamp || authorization.validBefore > block.timestamp + 5 minutes
            || (authorization.v != 27 && authorization.v != 28)) revert InvalidAuthorization();
    }

    function _receiveFunding(AutonomyTypes.CircleAuthorization calldata authorization, uint256 amount) private {
        uint256 beforeBalance = usdc.balanceOf(address(this));
        ICircleReceiveAuthorization(usdc).receiveWithAuthorization(
            authorization.from, authorization.to, authorization.value, authorization.validAfter,
            authorization.validBefore, authorization.nonce, authorization.v, authorization.r, authorization.s
        );
        if (usdc.balanceOf(address(this)) != beforeBalance + amount) revert TransferFailed();
    }
}
