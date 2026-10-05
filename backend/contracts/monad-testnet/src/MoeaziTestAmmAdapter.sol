// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ISwapVenueAdapter, MonadTestnetRegistry} from "./MonadTestnetRegistry.sol";
import {SafeToken} from "./SafeToken.sol";

/// @notice A small owner-seeded constant-product test venue for Monad Testnet.
/// It uses Circle's testnet USDC and the published Monad WMON token; it has no
/// external price feed, share token, or production guarantee.
contract MoeaziTestAmmAdapter is ISwapVenueAdapter {
    using SafeToken for address;

    uint256 public constant FEE_BPS = 30;
    uint256 private constant BPS = 10_000;
    address public immutable owner;
    address public constant usdc = MonadTestnetRegistry.USDC;
    address public constant wmon = MonadTestnetRegistry.WMON;
    uint112 public reserveUsdc;
    uint112 public reserveWmon;
    bool public paused;
    uint256 private _entered;

    event LiquidityAdded(uint256 usdcAmount, uint256 wmonAmount);
    event LiquidityRemoved(uint256 usdcAmount, uint256 wmonAmount);
    event Swap(address indexed caller, address indexed tokenIn, uint256 amountIn,
        address indexed tokenOut, uint256 amountOut);
    event PauseChanged(bool paused);

    error WrongChain();
    error Unauthorized();
    error InvalidAmount();
    error InvalidPair();
    error InsufficientLiquidity();
    error SlippageExceeded();
    error TransferFailed();
    error Reentrant();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_entered != 0) revert Reentrant();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(address owner_) {
        if (block.chainid != MonadTestnetRegistry.CHAIN_ID) revert WrongChain();
        if (owner_ == address(0)) revert Unauthorized();
        owner = owner_;
    }

    function addLiquidity(uint256 usdcAmount, uint256 wmonAmount) external nonReentrant onlyOwner {
        if (usdcAmount == 0 || wmonAmount == 0
            || uint256(reserveUsdc) + usdcAmount > type(uint112).max
            || uint256(reserveWmon) + wmonAmount > type(uint112).max) revert InvalidAmount();
        if (reserveUsdc == 0 && reserveWmon == 0) {
            // First seed establishes the test pool's initial price.
        } else if (reserveUsdc == 0 || reserveWmon == 0
            || usdcAmount * reserveWmon != wmonAmount * reserveUsdc) {
            revert InvalidAmount();
        }
        uint256 usdcBefore = usdc.balanceOf(address(this));
        uint256 wmonBefore = wmon.balanceOf(address(this));
        usdc.safeTransferFrom(owner, address(this), usdcAmount);
        wmon.safeTransferFrom(owner, address(this), wmonAmount);
        if (usdc.balanceOf(address(this)) != usdcBefore + usdcAmount
            || wmon.balanceOf(address(this)) != wmonBefore + wmonAmount) revert TransferFailed();
        reserveUsdc += uint112(usdcAmount);
        reserveWmon += uint112(wmonAmount);
        emit LiquidityAdded(usdcAmount, wmonAmount);
    }

    function removeLiquidity(uint256 usdcAmount, uint256 wmonAmount) external nonReentrant onlyOwner {
        if (usdcAmount == 0 || wmonAmount == 0 || usdcAmount > reserveUsdc || wmonAmount > reserveWmon) {
            revert InvalidAmount();
        }
        uint112 remainingUsdc = reserveUsdc - uint112(usdcAmount);
        uint112 remainingWmon = reserveWmon - uint112(wmonAmount);
        if ((remainingUsdc == 0) != (remainingWmon == 0)) revert InvalidAmount();
        if (remainingUsdc != 0 && usdcAmount * reserveWmon != wmonAmount * reserveUsdc) {
            revert InvalidAmount();
        }
        reserveUsdc = remainingUsdc;
        reserveWmon = remainingWmon;
        usdc.safeTransfer(owner, usdcAmount);
        wmon.safeTransfer(owner, wmonAmount);
        emit LiquidityRemoved(usdcAmount, wmonAmount);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PauseChanged(paused_);
    }

    function quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn, bytes calldata venueData)
        external view returns (uint256 amountOut, bool available)
    {
        if (venueData.length != 0 || amountIn == 0 || amountIn > type(uint112).max || paused) {
            return (0, false);
        }
        (uint256 reserveIn, uint256 reserveOut) = _reservesFor(tokenIn, tokenOut);
        if (reserveIn == 0 || reserveOut == 0) return (0, false);
        uint256 amountWithFee = amountIn * (BPS - FEE_BPS);
        amountOut = amountWithFee * reserveOut / (reserveIn * BPS + amountWithFee);
        available = amountOut != 0;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut,
        bytes calldata venueData) external nonReentrant returns (uint256 amountOut)
    {
        if (paused) revert InsufficientLiquidity();
        if (venueData.length != 0 || amountIn == 0 || minAmountOut == 0) revert InvalidAmount();
        (uint256 quoted, bool available) = _quoteExactInput(tokenIn, tokenOut, amountIn, venueData);
        if (!available) revert InsufficientLiquidity();
        if (quoted < minAmountOut) revert SlippageExceeded();
        uint256 beforeIn = tokenIn.balanceOf(address(this));
        uint256 beforeOut = tokenOut.balanceOf(address(this));
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);
        if (tokenIn.balanceOf(address(this)) != beforeIn + amountIn) revert TransferFailed();

        (, uint256 reserveOut) = _reservesFor(tokenIn, tokenOut);
        amountOut = quoted;
        if (amountOut > reserveOut || amountOut < minAmountOut) revert SlippageExceeded();
        if (tokenIn == usdc) {
            reserveUsdc += uint112(amountIn);
            reserveWmon -= uint112(amountOut);
        } else {
            reserveWmon += uint112(amountIn);
            reserveUsdc -= uint112(amountOut);
        }
        tokenOut.safeTransfer(msg.sender, amountOut);
        if (tokenOut.balanceOf(address(this)) != beforeOut - amountOut) revert TransferFailed();
        emit Swap(msg.sender, tokenIn, amountIn, tokenOut, amountOut);
    }

    function _reservesFor(address tokenIn, address tokenOut)
        private view returns (uint256 reserveIn, uint256 reserveOut)
    {
        if (tokenIn == usdc && tokenOut == wmon) return (reserveUsdc, reserveWmon);
        if (tokenIn == wmon && tokenOut == usdc) return (reserveWmon, reserveUsdc);
        revert InvalidPair();
    }

    function _quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn, bytes calldata venueData)
        private view returns (uint256 amountOut, bool available)
    {
        if (venueData.length != 0 || amountIn == 0 || amountIn > type(uint112).max || paused) {
            return (0, false);
        }
        (uint256 reserveIn, uint256 reserveOut) = _reservesFor(tokenIn, tokenOut);
        if (reserveIn == 0 || reserveOut == 0) return (0, false);
        uint256 amountWithFee = amountIn * (BPS - FEE_BPS);
        amountOut = amountWithFee * reserveOut / (reserveIn * BPS + amountWithFee);
        available = amountOut != 0;
    }
}
