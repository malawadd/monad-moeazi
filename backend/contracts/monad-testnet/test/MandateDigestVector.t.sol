// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "./TestBase.sol";
import {MeraMandate} from "../src/MeraMandate.sol";

contract MandateDigestHarness {
    function digest(MeraMandate.Mandate calldata mandate, address verifier) external view returns (bytes32) {
        return MeraMandate.digest(mandate, verifier);
    }
}

contract MandateDigestVectorTest is TestBase {
    function testMatchesViemHashTypedDataMonadVector() public {
        address verifier = 0x0000000000000000000000000000000000001001;
        address[] memory allowed = new address[](2);
        allowed[0] = 0x0000000000000000000000000000000000002001;
        allowed[1] = 0x0000000000000000000000000000000000002002;
        MeraMandate.Mandate memory mandate = MeraMandate.Mandate({
            chainId: 10143,
            vault: verifier,
            allowedAdapters: allowed,
            tokenIn: 0x534b2f3A21130d7a60830c2Df862319e593943A3,
            tokenOut: 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541,
            maxInputPerTrade: 2_500_000,
            maxTotalInput: 7_000_000,
            validAfter: 1_791_170_000,
            expiresAt: 1_791_173_600,
            nonce: 42
        });
        assertEq(block.chainid, 10143);
        bytes32 solidityDigest = new MandateDigestHarness().digest(mandate, verifier);
        assertEq(solidityDigest, 0xda907f731b85cc6eead3a98fdba7d935daaff3a507624cbb5877da416e3b2602);
    }
}
