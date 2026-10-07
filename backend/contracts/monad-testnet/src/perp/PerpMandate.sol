// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC1271} from "../MonadTestnetRegistry.sol";

library PerpMandate {
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("Moeazi Monad Testnet Perp");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant TYPEHASH = keccak256(
        "PerpMandate(uint256 chainId,address owner,address vault,address usdc,address clearinghouse,address executor,address[3] tokens,address[3] pools,uint256 fundingAmount,uint64 durationSeconds,uint64 setupDeadline,uint8 policyVersion,uint256 nonce)"
    );
    uint256 private constant HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct Mandate {
        uint256 chainId;
        address owner;
        address vault;
        address usdc;
        address clearinghouse;
        address executor;
        address[3] tokens;
        address[3] pools;
        uint256 fundingAmount;
        uint64 durationSeconds;
        uint64 setupDeadline;
        uint8 policyVersion;
        uint256 nonce;
    }

    function digest(Mandate calldata m, address verifier) internal view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(
            DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, verifier
        ));
        bytes32 body = structHash(m);
        return keccak256(abi.encodePacked("\x19\x01", domain, body));
    }

    function structHash(Mandate calldata m) internal pure returns (bytes32 result) {
        bytes32 typeHash = TYPEHASH;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            let arrays := add(ptr, 0x1c0)
            mstore(arrays, calldataload(add(m, 0xc0)))
            mstore(add(arrays, 0x20), calldataload(add(m, 0xe0)))
            mstore(add(arrays, 0x40), calldataload(add(m, 0x100)))
            let tokensHash := keccak256(arrays, 0x60)
            mstore(arrays, calldataload(add(m, 0x120)))
            mstore(add(arrays, 0x20), calldataload(add(m, 0x140)))
            mstore(add(arrays, 0x40), calldataload(add(m, 0x160)))
            let poolsHash := keccak256(arrays, 0x60)
            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), calldataload(m))
            mstore(add(ptr, 0x40), calldataload(add(m, 0x20)))
            mstore(add(ptr, 0x60), calldataload(add(m, 0x40)))
            mstore(add(ptr, 0x80), calldataload(add(m, 0x60)))
            mstore(add(ptr, 0xa0), calldataload(add(m, 0x80)))
            mstore(add(ptr, 0xc0), calldataload(add(m, 0xa0)))
            mstore(add(ptr, 0xe0), tokensHash)
            mstore(add(ptr, 0x100), poolsHash)
            mstore(add(ptr, 0x120), calldataload(add(m, 0x180)))
            mstore(add(ptr, 0x140), calldataload(add(m, 0x1a0)))
            mstore(add(ptr, 0x160), calldataload(add(m, 0x1c0)))
            mstore(add(ptr, 0x180), calldataload(add(m, 0x1e0)))
            mstore(add(ptr, 0x1a0), calldataload(add(m, 0x200)))
            result := keccak256(ptr, 0x1c0)
            mstore(0x40, add(ptr, 0x220))
        }
    }

    function isOwnerSignature(address owner, bytes32 signedDigest, bytes calldata sig)
        internal view returns (bool)
    {
        if (owner.code.length != 0) {
            (bool ok, bytes memory result) = owner.staticcall(
                abi.encodeCall(IERC1271.isValidSignature, (signedDigest, sig))
            );
            return ok && result.length >= 32 && abi.decode(result, (bytes4)) == ERC1271_MAGICVALUE;
        }
        if (sig.length != 65) return false;
        bytes32 r; bytes32 s; uint8 v;
        assembly ("memory-safe") {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (uint256(s) > HALF_ORDER || (v != 27 && v != 28)) return false;
        return ecrecover(signedDigest, v, r, s) == owner;
    }
}
