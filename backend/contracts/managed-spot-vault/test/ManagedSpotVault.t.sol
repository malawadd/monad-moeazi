// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ManagedSpotVault, IERC20VaultAsset, ISwapRouterV3} from "../src/ManagedSpotVault.sol";

interface Vm {
    function prank(address caller) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
}

contract TestToken is IERC20VaultAsset {
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    function transfer(address to, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount);
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(balanceOf[from] >= amount && allowance[from][msg.sender] >= amount);
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract TestRouter is ISwapRouterV3 {
    function exactInputSingle(ExactInputSingleParams calldata params)
        external payable override returns (uint256 amountOut)
    {
        require(params.fee == 3000 && params.recipient == msg.sender);
        require(IERC20VaultAsset(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn));
        amountOut = params.amountIn;
        require(amountOut >= params.amountOutMinimum);
        TestToken(params.tokenOut).mint(params.recipient, amountOut);
    }
}

contract ManagedSpotVaultTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant OWNER = address(0xA11CE);
    address private constant EXECUTOR = address(0xB0B);
    address private constant STRANGER = address(0xCAFE);

    TestToken private usdc;
    TestToken private weth;
    TestRouter private router;
    ManagedSpotVault private vault;

    function setUp() public {
        usdc = new TestToken();
        weth = new TestToken();
        router = new TestRouter();
        vault = new ManagedSpotVault(OWNER, EXECUTOR, address(usdc), address(weth), address(router),
            keccak256("program-v1"), keccak256("policy-v1"), 200, 40, uint64(block.timestamp + 7 days));
        usdc.mint(OWNER, 500);
        vm.prank(OWNER);
        usdc.approve(address(vault), 200);
    }

    function testRepeatedTradesUseOnlyCommittedCapitalAndOwnerWithdraws() public {
        vm.prank(OWNER);
        vault.fund();
        assert(usdc.balanceOf(OWNER) == 300);
        assert(usdc.balanceOf(address(vault)) == 200);

        vm.prank(EXECUTOR);
        vault.buy(bytes32(uint256(1)), 40, 40, block.timestamp + 60);
        vm.prank(EXECUTOR);
        vault.buy(bytes32(uint256(2)), 30, 30, block.timestamp + 60);
        assert(weth.balanceOf(address(vault)) == 70);
        assert(usdc.balanceOf(address(vault)) == 130);

        vm.prank(OWNER);
        vault.stop();
        vm.prank(EXECUTOR);
        vault.sell(bytes32(uint256(3)), 70, 70, block.timestamp + 60);
        vm.prank(OWNER);
        vault.withdrawUsdc();
        assert(usdc.balanceOf(OWNER) == 500);
        assert(usdc.balanceOf(address(vault)) == 0);
    }

    function testNoEntryAfterStopAndOpenExposureBlocksWithdrawal() public {
        vm.prank(OWNER);
        vault.fund();
        vm.prank(EXECUTOR);
        vault.buy(bytes32(uint256(1)), 40, 40, block.timestamp + 60);
        vm.prank(EXECUTOR);
        vault.stop();

        vm.expectRevert(ManagedSpotVault.NotActive.selector);
        vm.prank(EXECUTOR);
        vault.buy(bytes32(uint256(2)), 1, 1, block.timestamp + 60);
        vm.expectRevert(ManagedSpotVault.PositionOpen.selector);
        vm.prank(OWNER);
        vault.withdrawUsdc();

        vm.prank(OWNER);
        vault.recoverWeth();
        vm.prank(OWNER);
        vault.withdrawUsdc();
        assert(weth.balanceOf(OWNER) == 40);
        assert(usdc.balanceOf(OWNER) == 460);
    }

    function testOnlyExecutorTradesAndOrderIdsCannotReplay() public {
        vm.prank(OWNER);
        vault.fund();
        vm.expectRevert(ManagedSpotVault.Unauthorized.selector);
        vm.prank(STRANGER);
        vault.buy(bytes32(uint256(1)), 1, 1, block.timestamp + 60);
        vm.expectRevert(ManagedSpotVault.InvalidOrder.selector);
        vm.prank(EXECUTOR);
        vault.buy(bytes32(uint256(1)), 41, 41, block.timestamp + 60);

        vm.prank(EXECUTOR);
        vault.buy(bytes32(uint256(1)), 40, 40, block.timestamp + 60);
        vm.expectRevert(ManagedSpotVault.InvalidOrder.selector);
        vm.prank(EXECUTOR);
        vault.buy(bytes32(uint256(1)), 40, 40, block.timestamp + 60);
    }

    function testExpiryStopsEntriesButAllowsCloseAndWithdrawal() public {
        vm.prank(OWNER);
        vault.fund();
        vm.prank(EXECUTOR);
        vault.buy(bytes32(uint256(1)), 20, 20, block.timestamp + 60);
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(ManagedSpotVault.NotActive.selector);
        vm.prank(EXECUTOR);
        vault.buy(bytes32(uint256(2)), 1, 1, block.timestamp + 60);
        vm.prank(EXECUTOR);
        vault.sell(bytes32(uint256(3)), 20, 20, block.timestamp + 60);
        vm.prank(OWNER);
        vault.withdrawUsdc();
        assert(usdc.balanceOf(OWNER) == 500);
    }
}
