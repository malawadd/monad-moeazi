// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC1271} from "../MonadTestnetRegistry.sol";

library PerplStrategyMandate {
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("Moeazi Perpl Strategy Vault");
    bytes32 private constant VERSION_HASH = keccak256("2");
    bytes32 private constant TYPEHASH = keccak256(
        "PerplRunMandate(uint256 chainId,address owner,address vault,address collateralToken,address operator,uint8 transport,uint256 fundingAmount,uint256 maxPositionExposure,uint8 maxLeverage,uint64 durationSeconds,uint64 setupDeadline,uint8 policyVersion,uint256 nonce,uint256[] marketIds)"
    );
    uint256 private constant HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    uint8 internal constant TRANSPORT_DIRECT_ONCHAIN = 1;
    uint8 internal constant TRANSPORT_API_FORWARDING = 2;

    struct Mandate {
        uint256 chainId;
        address owner;
        address vault;
        address collateralToken;
        address operator;
        uint8 transport;
        uint256 fundingAmount;
        uint256 maxPositionExposure;
        uint8 maxLeverage;
        uint64 durationSeconds;
        uint64 setupDeadline;
        uint8 policyVersion;
        uint256 nonce;
        uint256[] marketIds;
    }

    function digest(Mandate calldata mandate, address verifier) internal view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, verifier));
        bytes memory first = abi.encode(
            TYPEHASH, mandate.chainId, mandate.owner, mandate.vault, mandate.collateralToken, mandate.operator,
            mandate.transport
        );
        bytes memory second = abi.encode(
            mandate.fundingAmount,
            mandate.maxPositionExposure,
            mandate.maxLeverage,
            mandate.durationSeconds,
            mandate.setupDeadline
        );
        bytes memory third =
            abi.encode(mandate.policyVersion, mandate.nonce, keccak256(abi.encodePacked(mandate.marketIds)));
        bytes32 body = keccak256(abi.encodePacked(first, second, third));
        return keccak256(abi.encodePacked("\x19\x01", domain, body));
    }

    function isOwnerSignature(address owner, bytes32 signedDigest, bytes calldata signature)
        internal
        view
        returns (bool)
    {
        if (owner.code.length != 0) {
            (bool ok, bytes memory result) =
                owner.staticcall(abi.encodeCall(IERC1271.isValidSignature, (signedDigest, signature)));
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
