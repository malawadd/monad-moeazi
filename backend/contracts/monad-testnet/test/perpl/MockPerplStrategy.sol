// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPerplSettlementExchange, PerplTestnetRegistry} from "../../src/perpl/PerplTestnetRegistry.sol";

contract MockPerplAUSD {
    mapping(address => uint256) public balanceOf;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockPerplStrategyExchange is IPerplSettlementExchange {
    mapping(uint256 => AccountInfo) private _accounts;
    mapping(uint256 => OrderLock[]) private _locks;
    uint256 public accountCount;

    function createAccount(uint256 amount) external returns (uint256 id) {
        id = ++accountCount;
        _accounts[id].accountId = id;
        _accounts[id].balanceCNS = amount;
        _accounts[id].accountAddr = msg.sender;
    }

    function depositCollateral(uint256 id, uint256 amount) external {
        _accounts[id].balanceCNS += amount;
    }

    function withdrawCollateral(uint256 id, uint256 amount) external {
        _accounts[id].balanceCNS -= amount;
    }

    function setPositions(uint256 id, uint256 a, uint256 b, uint256 c, uint256 d) external {
        _accounts[id].positions = PositionBitMap(a, b, c, d);
    }

    function setPendingOrder(uint256 id, bool pending) external {
        delete _locks[id];
        if (pending) _locks[id].push(OrderLock(1, 0, 0, 0, 1, 1));
    }

    function getAccountById(uint256 id) external view returns (AccountInfo memory) {
        return _accounts[id];
    }

    function getOrderLocks(uint256 id) external view returns (OrderLock[] memory) {
        return _locks[id];
    }

    function getExchangeInfo()
        external
        pure
        returns (uint256, uint256, uint256, uint256 collateralDecimals, address collateralToken, address)
    {
        return (0, 0, 0, PerplTestnetRegistry.AUSD_DECIMALS, PerplTestnetRegistry.AUSD, address(0));
    }
}

contract MockPerplStrategyDelegatedAccount {
    address public owner;
    address public exchange;
    address public collateralToken;
    uint256 public accountId;
    mapping(address => bool) public isOperator;
    bool public forwardingAllowed;
    mapping(bytes4 => bool) public operatorAllowlist;
    error Unauthorized();
    error InvalidSignature();

    constructor(address owner_, address operator_, address exchange_, address token_) {
        owner = owner_;
        exchange = exchange_;
        collateralToken = token_;
        isOperator[operator_] = true;
    }

    function createAccount(uint256 amount) external onlyOwner {
        accountId = MockPerplStrategyExchange(exchange).createAccount(amount);
    }

    function depositCollateral(uint256 amount) external onlyOwner {
        MockPerplStrategyExchange(exchange).depositCollateral(accountId, amount);
    }

    function withdrawCollateral(uint256 amount) external onlyOwner {
        MockPerplStrategyExchange(exchange).withdrawCollateral(accountId, amount);
        require(MockPerplAUSD(collateralToken).transfer(owner, amount));
    }

    function allowOrderForwarding(bool allowed) external onlyOwner {
        forwardingAllowed = allowed;
    }

    function setOperatorAllowlist(bytes4 selector, bool allowed) external onlyOwner {
        operatorAllowlist[selector] = allowed;
    }

    function removeOperator(address operator) external onlyOwner {
        isOperator[operator] = false;
    }

    function addOperator(address operator, uint256 deadline, bytes calldata signature) external onlyOwner {
        if (deadline < block.timestamp) revert InvalidSignature();
        if (signature.length == 0) revert InvalidSignature();
        isOperator[operator] = true;
    }

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        require(MockPerplAUSD(token).transfer(owner, amount));
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
}

contract MockPerplStrategyDelegatedAccountFactory {
    address public immutable token;
    address public immutable exchange;
    uint256 public createCount;

    constructor(address token_, address exchange_) {
        token = token_;
        exchange = exchange_;
    }

    function create(address operator, uint256 deadline, bytes calldata signature) external returns (address proxy) {
        require(deadline >= block.timestamp && signature.length != 0);
        proxy = address(new MockPerplStrategyDelegatedAccount(msg.sender, operator, exchange, token));
        ++createCount;
    }
}
