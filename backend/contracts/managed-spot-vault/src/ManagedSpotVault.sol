// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20VaultAsset {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface ISwapRouterV3 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice Isolates one Magic owner's committed USDC for one frozen managed program.
/// The executor can only exchange the committed capital and its proceeds between
/// the fixed USDC/WETH pair. It cannot transfer assets to itself or add collateral.
contract ManagedSpotVault {
    address public immutable owner;
    address public immutable executor;
    IERC20VaultAsset public immutable usdc;
    IERC20VaultAsset public immutable weth;
    ISwapRouterV3 public immutable router;
    bytes32 public immutable programVersionHash;
    bytes32 public immutable policyHash;
    uint256 public immutable capitalUnits;
    uint256 public immutable maxBuyUnits;
    uint64 public immutable expiresAt;

    bool public funded;
    bool public stopped;
    mapping(bytes32 => bool) public executedOrders;
    uint256 private entered;

    event Funded(address indexed owner, uint256 amount, bytes32 indexed programVersionHash);
    event OrderFilled(bytes32 indexed orderId, bool indexed isBuy, uint256 amountIn, uint256 amountOut);
    event Stopped(address indexed caller);
    event Withdrawn(address indexed owner, address indexed asset, uint256 amount);

    error Unauthorized();
    error InvalidConfiguration();
    error NotActive();
    error AlreadyFunded();
    error InvalidOrder();
    error TransferFailed();
    error PositionOpen();
    error Reentrant();

    modifier locked() {
        if (entered != 0) revert Reentrant();
        entered = 1;
        _;
        entered = 0;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert Unauthorized();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(
        address owner_, address executor_, address usdc_, address weth_, address router_,
        bytes32 programVersionHash_, bytes32 policyHash_, uint256 capitalUnits_,
        uint256 maxBuyUnits_, uint64 expiresAt_
    ) {
        if (owner_ == address(0) || executor_ == address(0) || usdc_ == address(0)
            || weth_ == address(0) || router_ == address(0) || usdc_ == weth_
            || programVersionHash_ == bytes32(0) || policyHash_ == bytes32(0)
            || capitalUnits_ == 0 || maxBuyUnits_ == 0 || maxBuyUnits_ > capitalUnits_
            || expiresAt_ <= block.timestamp) revert InvalidConfiguration();
        owner = owner_;
        executor = executor_;
        usdc = IERC20VaultAsset(usdc_);
        weth = IERC20VaultAsset(weth_);
        router = ISwapRouterV3(router_);
        programVersionHash = programVersionHash_;
        policyHash = policyHash_;
        capitalUnits = capitalUnits_;
        maxBuyUnits = maxBuyUnits_;
        expiresAt = expiresAt_;
    }

    /// @dev The owner calls this through its existing Magic-signed UA transaction.
    /// An approve + fund batch can require one owner transaction signature.
    function fund() external onlyOwner locked {
        if (funded) revert AlreadyFunded();
        if (stopped || block.timestamp >= expiresAt) revert NotActive();
        uint256 beforeBalance = usdc.balanceOf(address(this));
        if (!usdc.transferFrom(owner, address(this), capitalUnits)) revert TransferFailed();
        if (usdc.balanceOf(address(this)) != beforeBalance + capitalUnits) revert TransferFailed();
        funded = true;
        emit Funded(owner, capitalUnits, programVersionHash);
    }

    function buy(bytes32 orderId, uint256 amountIn, uint256 minWethOut, uint256 deadline)
        external onlyExecutor locked returns (uint256 amountOut)
    {
        if (!funded || stopped || block.timestamp >= expiresAt) revert NotActive();
        if (amountIn == 0 || amountIn > maxBuyUnits || amountIn > usdc.balanceOf(address(this))
            || minWethOut == 0) revert InvalidOrder();
        _checkOrder(orderId, deadline);
        amountOut = _swap(usdc, weth, amountIn, minWethOut, deadline);
        emit OrderFilled(orderId, true, amountIn, amountOut);
    }

    /// @notice Closing remains possible after Stop or expiry; no new buy is possible.
    function sell(bytes32 orderId, uint256 amountIn, uint256 minUsdcOut, uint256 deadline)
        external onlyExecutor locked returns (uint256 amountOut)
    {
        if (!funded || amountIn == 0 || amountIn > weth.balanceOf(address(this))
            || minUsdcOut == 0) revert InvalidOrder();
        _checkOrder(orderId, deadline);
        amountOut = _swap(weth, usdc, amountIn, minUsdcOut, deadline);
        emit OrderFilled(orderId, false, amountIn, amountOut);
    }

    function stop() external locked {
        if (msg.sender != owner && msg.sender != executor) revert Unauthorized();
        if (!stopped) {
            stopped = true;
            emit Stopped(msg.sender);
        }
    }

    function withdrawUsdc() external onlyOwner locked returns (uint256 amount) {
        if (!stopped && block.timestamp < expiresAt) revert NotActive();
        if (weth.balanceOf(address(this)) != 0) revert PositionOpen();
        amount = usdc.balanceOf(address(this));
        if (amount != 0 && !usdc.transfer(owner, amount)) revert TransferFailed();
        emit Withdrawn(owner, address(usdc), amount);
    }

    /// @notice Owner escape hatch if the executor cannot close an open WETH position.
    function recoverWeth() external onlyOwner locked returns (uint256 amount) {
        if (!stopped && block.timestamp < expiresAt) revert NotActive();
        amount = weth.balanceOf(address(this));
        if (amount != 0 && !weth.transfer(owner, amount)) revert TransferFailed();
        emit Withdrawn(owner, address(weth), amount);
    }

    function _checkOrder(bytes32 orderId, uint256 deadline) private {
        if (orderId == bytes32(0) || executedOrders[orderId]
            || deadline < block.timestamp || deadline > block.timestamp + 300) revert InvalidOrder();
        executedOrders[orderId] = true;
    }

    function _swap(IERC20VaultAsset assetIn, IERC20VaultAsset assetOut,
        uint256 amountIn, uint256 minOut, uint256 deadline) private returns (uint256 received)
    {
        uint256 beforeOut = assetOut.balanceOf(address(this));
        if (!assetIn.approve(address(router), amountIn)) revert TransferFailed();
        router.exactInputSingle(ISwapRouterV3.ExactInputSingleParams({
            tokenIn: address(assetIn), tokenOut: address(assetOut), fee: 3000,
            recipient: address(this), deadline: deadline, amountIn: amountIn,
            amountOutMinimum: minOut, sqrtPriceLimitX96: 0
        }));
        if (!assetIn.approve(address(router), 0)) revert TransferFailed();
        received = assetOut.balanceOf(address(this)) - beforeOut;
        if (received < minOut) revert InvalidOrder();
    }
}
