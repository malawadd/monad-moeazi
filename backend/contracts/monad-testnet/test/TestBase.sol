// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface VmTest {
    function etch(address target, bytes calldata code) external;
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function warp(uint256 timestamp) external;
    function chainId(uint256 newChainId) external;
}

abstract contract TestBase {
    VmTest internal constant vm = VmTest(address(uint160(uint256(keccak256("hevm cheat code")))));

    error AssertionFailed();

    function assertTrue(bool value) internal pure {
        if (!value) revert AssertionFailed();
    }

    function assertFalse(bool value) internal pure {
        if (value) revert AssertionFailed();
    }

    function assertEq(uint256 left, uint256 right) internal pure {
        if (left != right) revert AssertionFailed();
    }

    function assertEq(address left, address right) internal pure {
        if (left != right) revert AssertionFailed();
    }

    function assertEq(bytes32 left, bytes32 right) internal pure {
        if (left != right) revert AssertionFailed();
    }
}

/// @dev Minimal test token etched at Monad's canonical addresses on local test EVMs.
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 permitted = allowance[from][msg.sender];
        if (permitted != type(uint256).max) allowance[from][msg.sender] = permitted - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
