// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "../TestBase.sol";
import {AutonomyMandate} from "../../src/autonomy/AutonomyMandate.sol";

contract AutonomyMandateDigestHarness {
    function hash(AutonomyMandate.StrategyMandate calldata mandate, address verifier)
        external view returns (bytes32)
    {
        return AutonomyMandate.digest(mandate, verifier);
    }
}

contract AutonomyMandateDigestVectorTest is TestBase {
    function testViemEip712Vector() public {
        vm.chainId(10143);
        AutonomyMandate.StrategyMandate memory m;
        m.chainId = 10143;
        m.owner = 0x2222222222222222222222222222222222222222;
        m.vault = 0x1111111111111111111111111111111111111111;
        m.usdc = 0x534b2f3A21130d7a60830c2Df862319e593943A3;
        m.tokens = [
            0x3333333333333333333333333333333333333333,
            0x4444444444444444444444444444444444444444,
            0x5555555555555555555555555555555555555555
        ];
        m.pools = [
            0x6666666666666666666666666666666666666666,
            0x7777777777777777777777777777777777777777,
            0x8888888888888888888888888888888888888888
        ];
        m.fundingAmount = 1_234_567;
        m.durationSeconds = 3_600;
        m.startBy = 1_700_000_300;
        m.maxCycles = 3;
        m.buySlippageBps = 250;
        m.sellSlippageBps = 300;
        m.nonce = 7;

        bytes32 digest = new AutonomyMandateDigestHarness().hash(m, m.vault);
        assertEq(digest, 0xedbce9af03ffe02430874e78a19d90159bab5d7a97fa35275d8441566640e4da);
    }
}
