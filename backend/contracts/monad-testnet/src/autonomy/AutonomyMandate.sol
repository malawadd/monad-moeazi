// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC1271} from "../MonadTestnetRegistry.sol";

library AutonomyMandate {
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("Moeazi Monad Testnet Autonomy");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant TYPEHASH = keccak256(
        "StrategyMandate(uint256 chainId,address owner,address vault,address usdc,address[3] tokens,address[3] pools,uint256 fundingAmount,uint64 durationSeconds,uint64 startBy,uint8 maxCycles,uint16 buySlippageBps,uint16 sellSlippageBps,uint256 nonce)"
    );
    uint256 private constant HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct StrategyMandate {
        uint256 chainId;
        address owner;
        address vault;
        address usdc;
        address[3] tokens;
        address[3] pools;
        uint256 fundingAmount;
        uint64 durationSeconds;
        uint64 startBy;
        uint8 maxCycles;
        uint16 buySlippageBps;
        uint16 sellSlippageBps;
        uint256 nonce;
    }

    function digest(StrategyMandate calldata mandate, address verifyingContract)
        internal view returns (bytes32)
    {
        bytes32 domain = keccak256(abi.encode(
            DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, verifyingContract
        ));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash(mandate)));
    }

    function structHash(StrategyMandate calldata mandate) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            TYPEHASH, mandate.chainId, mandate.owner, mandate.vault, mandate.usdc,
            keccak256(abi.encode(mandate.tokens)), keccak256(abi.encode(mandate.pools)),
            mandate.fundingAmount, mandate.durationSeconds, mandate.startBy, mandate.maxCycles,
            mandate.buySlippageBps, mandate.sellSlippageBps, mandate.nonce
        ));
    }

    function isOwnerSignature(address owner, bytes32 signedDigest, bytes calldata signature)
        internal view returns (bool)
    {
        if (owner.code.length != 0) {
            (bool ok, bytes memory result) = owner.staticcall(
                abi.encodeCall(IERC1271.isValidSignature, (signedDigest, signature))
            );
            return ok && result.length >= 32 && abi.decode(result, (bytes4)) == ERC1271_MAGICVALUE;
        }
        if (signature.length != 65) return false;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > HALF_ORDER || (v != 27 && v != 28)) return false;
        return ecrecover(signedDigest, v, r, s) == owner;
    }
}
