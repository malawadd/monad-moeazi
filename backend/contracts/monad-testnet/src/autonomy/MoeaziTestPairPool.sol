// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SafeToken} from "../SafeToken.sol";
import {MonadTestnetRegistry} from "../MonadTestnetRegistry.sol";

/// @notice Fixed USDC/mock-token constant-product pool for Monad Testnet scenarios.
contract MoeaziTestPairPool {
    using SafeToken for address;

    uint256 public constant FEE_BPS = 30;
    uint256 private constant BPS = 10_000;
    address public immutable owner;
    address public immutable usdc;
    address public immutable token;
    uint112 public reserveUsdc;
    uint112 public reserveToken;
    uint256 private _entered;

    error WrongChain();
    error Unauthorized();
    error InvalidPair();
    error InvalidAmount();
    error InsufficientLiquidity();
    error SlippageExceeded();
    error TransferFailed();
    error Reentrant();

    event LiquidityAdded(uint256 usdcAmount, uint256 tokenAmount);
    event Swap(address indexed caller, address indexed tokenIn, uint256 amountIn,
        address indexed tokenOut, uint256 amountOut);

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

    constructor(address owner_, address usdc_, address token_) {
        if (block.chainid != MonadTestnetRegistry.CHAIN_ID) revert WrongChain();
        if (owner_ == address(0) || usdc_ != MonadTestnetRegistry.USDC
            || token_ == address(0) || token_ == usdc_ || token_.code.length == 0) revert InvalidPair();
        owner = owner_;
        usdc = usdc_;
        token = token_;
    }

    function addLiquidity(uint256 usdcAmount, uint256 tokenAmount) external onlyOwner nonReentrant {
        if (usdcAmount == 0 || tokenAmount == 0
            || uint256(reserveUsdc) + usdcAmount > type(uint112).max
            || uint256(reserveToken) + tokenAmount > type(uint112).max) revert InvalidAmount();
        if (reserveUsdc == 0 && reserveToken == 0) {
            // The seed establishes the initial human price.
        } else if (reserveUsdc == 0 || reserveToken == 0
            || usdcAmount * reserveToken != tokenAmount * reserveUsdc) revert InvalidAmount();
        uint256 beforeUsdc = usdc.balanceOf(address(this));
        uint256 beforeToken = token.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        token.safeTransferFrom(msg.sender, address(this), tokenAmount);
        if (usdc.balanceOf(address(this)) != beforeUsdc + usdcAmount
            || token.balanceOf(address(this)) != beforeToken + tokenAmount) revert TransferFailed();
        reserveUsdc += uint112(usdcAmount);
        reserveToken += uint112(tokenAmount);
        emit LiquidityAdded(usdcAmount, tokenAmount);
    }

    function getReserves() external view returns (uint112 usdcReserve, uint112 tokenReserve) {
        return (reserveUsdc, reserveToken);
    }

    function spotPriceUsdcPerTokenWad() external view returns (uint256) {
        if (reserveUsdc == 0 || reserveToken == 0) return 0;
        return uint256(reserveUsdc) * 1e30 / reserveToken;
    }

    function quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn)
        external view returns (uint256 amountOut, bool available)
    {
        return _quote(tokenIn, tokenOut, amountIn, false);
    }

    function quoteSpotExactInput(address tokenIn, address tokenOut, uint256 amountIn)
        external view returns (uint256 amountOut, bool available)
    {
        return _quote(tokenIn, tokenOut, amountIn, true);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external nonReentrant returns (uint256 amountOut)
    {
        if (amountIn == 0 || minAmountOut == 0) revert InvalidAmount();
        (uint256 quoted, bool available) = _quote(tokenIn, tokenOut, amountIn, false);
        if (!available) revert InsufficientLiquidity();
        if (quoted < minAmountOut) revert SlippageExceeded();
        uint256 beforeIn = tokenIn.balanceOf(address(this));
        uint256 beforeOut = tokenOut.balanceOf(address(this));
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);
        if (tokenIn.balanceOf(address(this)) != beforeIn + amountIn) revert TransferFailed();
        amountOut = quoted;
        _updateReserves(tokenIn, amountIn, amountOut);
        tokenOut.safeTransfer(msg.sender, amountOut);
        if (tokenOut.balanceOf(address(this)) != beforeOut - amountOut) revert TransferFailed();
        emit Swap(msg.sender, tokenIn, amountIn, tokenOut, amountOut);
    }

    function _quote(address tokenIn, address tokenOut, uint256 amountIn, bool spotOnly)
        private view returns (uint256 amountOut, bool available)
    {
        if (amountIn == 0 || amountIn > type(uint112).max) return (0, false);
        (uint256 reserveIn, uint256 reserveOut) = _reservesFor(tokenIn, tokenOut);
        if (reserveIn == 0 || reserveOut == 0) return (0, false);
        if (spotOnly) amountOut = amountIn * reserveOut / reserveIn;
        else {
            uint256 amountWithFee = amountIn * (BPS - FEE_BPS);
            amountOut = amountWithFee * reserveOut / (reserveIn * BPS + amountWithFee);
        }
        available = amountOut != 0 && amountOut < reserveOut;
    }

    function _reservesFor(address tokenIn, address tokenOut)
        private view returns (uint256 reserveIn, uint256 reserveOut)
    {
        if (tokenIn == usdc && tokenOut == token) return (reserveUsdc, reserveToken);
        if (tokenIn == token && tokenOut == usdc) return (reserveToken, reserveUsdc);
        revert InvalidPair();
    }

    function _updateReserves(address tokenIn, uint256 amountIn, uint256 amountOut) private {
        if (tokenIn == usdc) {
            reserveUsdc += uint112(amountIn);
            reserveToken -= uint112(amountOut);
        } else {
            reserveToken += uint112(amountIn);
            reserveUsdc -= uint112(amountOut);
        }
    }
}
