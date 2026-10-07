// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Local EIP-3009 receiveWithAuthorization model at Circle's Monad address.
contract MockCircleUSDC {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("USDC");
    bytes32 private constant VERSION_HASH = keccak256("2");
    bytes32 private constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    uint256 public totalSupply;

    error UnauthorizedPayee();
    error AuthorizationAlreadyUsed();
    error AuthorizationExpired();
    error InvalidSignature();
    error InsufficientBalance();
    error InsufficientAllowance();

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function authorizationDigest(address from, address to, uint256 value, uint256 validAfter,
        uint256 validBefore, bytes32 nonce) external view returns (bytes32)
    {
        bytes32 domain = keccak256(abi.encode(
            DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)
        ));
        bytes32 message = keccak256(abi.encode(
            RECEIVE_TYPEHASH, from, to, value, validAfter, validBefore, nonce
        ));
        return keccak256(abi.encodePacked("\x19\x01", domain, message));
    }

    function receiveWithAuthorization(address from, address to, uint256 value,
        uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external
    {
        if (to != msg.sender) revert UnauthorizedPayee();
        if (authorizationState[from][nonce]) revert AuthorizationAlreadyUsed();
        if (block.timestamp <= validAfter || block.timestamp >= validBefore) revert AuthorizationExpired();
        bytes32 domain = keccak256(abi.encode(
            DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)
        ));
        bytes32 message = keccak256(abi.encode(
            RECEIVE_TYPEHASH, from, to, value, validAfter, validBefore, nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, message));
        if (ecrecover(digest, v, r, s) != from) revert InvalidSignature();
        authorizationState[from][nonce] = true;
        _transfer(from, to, value);
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (balanceOf[from] < amount) revert InsufficientBalance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
