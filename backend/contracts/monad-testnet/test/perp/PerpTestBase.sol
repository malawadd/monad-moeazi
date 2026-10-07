// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "../TestBase.sol";
import {MonadTestnetRegistry} from "../../src/MonadTestnetRegistry.sol";
import {AutonomyTypes} from "../../src/autonomy/AutonomyTypes.sol";
import {FixedSupplyMockToken} from "../../src/autonomy/FixedSupplyMockToken.sol";
import {MoeaziTestPairPool} from "../../src/autonomy/MoeaziTestPairPool.sol";
import {PerpMandate} from "../../src/perp/PerpMandate.sol";
import {PerpVaultFactory} from "../../src/perp/PerpVaultFactory.sol";
import {PerpVault} from "../../src/perp/PerpVault.sol";
import {PerpClearinghouse} from "../../src/perp/PerpClearinghouse.sol";
import {PerpClearinghouseBase} from "../../src/perp/PerpClearinghouseBase.sol";
import {MockCircleUSDC} from "../autonomy/MockCircleUSDC.sol";

abstract contract PerpTestBase is TestBase {
    uint256 internal constant OWNER_KEY = 0xA11CE;
    address internal constant OPERATOR = address(0xB0B);
    address internal constant USDC = MonadTestnetRegistry.USDC;
    MockCircleUSDC internal circle;
    address[3] internal tokens;
    address[3] internal pools;
    PerpClearinghouse internal clearinghouse;
    PerpVaultFactory internal factory;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        vm.etch(USDC, type(MockCircleUSDC).runtimeCode);
        circle = MockCircleUSDC(USDC);
        circle.mint(OPERATOR, 1_000e6);
        for (uint8 i; i < 3; ++i) {
            FixedSupplyMockToken token = new FixedSupplyMockToken("Test Token", "MOE", OPERATOR, 1_000_000 ether);
            MoeaziTestPairPool pool = new MoeaziTestPairPool(OPERATOR, USDC, address(token));
            vm.prank(OPERATOR); circle.approve(address(pool), 100e6);
            vm.prank(OPERATOR); token.approve(address(pool), 100_000 ether);
            vm.prank(OPERATOR); pool.addLiquidity(100e6, 100_000 ether);
            tokens[i] = address(token); pools[i] = address(pool);
        }
        clearinghouse = new PerpClearinghouse(OPERATOR, USDC, tokens, pools);
        factory = new PerpVaultFactory(OPERATOR, OPERATOR, USDC, address(clearinghouse), tokens, pools);
        vm.prank(OPERATOR); clearinghouse.setFactory(address(factory));
        vm.prank(OPERATOR); factory.setEnrollmentEnabled(true);
        vm.prank(OPERATOR); circle.approve(address(clearinghouse), 100e6);
        vm.prank(OPERATOR); clearinghouse.depositReserve(10e6);
    }

    function _prepare(uint256 ownerKey, uint256 amount, uint64 duration, uint256 authNonce)
        internal returns (AutonomyTypes.CircleAuthorization memory auth,
            PerpMandate.Mandate memory mandate, bytes memory signature)
    {
        address owner_ = vm.addr(ownerKey);
        circle.mint(owner_, amount);
        address vault = factory.predictVault(owner_, factory.enrollmentNonce(owner_));
        auth.from = owner_; auth.to = vault; auth.value = amount;
        auth.validAfter = block.timestamp - 1; auth.validBefore = block.timestamp + 5 minutes;
        auth.nonce = bytes32(authNonce);
        bytes32 authDigest = circle.authorizationDigest(auth.from, auth.to, auth.value,
            auth.validAfter, auth.validBefore, auth.nonce);
        (auth.v, auth.r, auth.s) = vm.sign(ownerKey, authDigest);
        mandate.chainId = MonadTestnetRegistry.CHAIN_ID; mandate.owner = owner_; mandate.vault = vault;
        mandate.usdc = USDC; mandate.clearinghouse = address(clearinghouse); mandate.executor = OPERATOR;
        mandate.tokens = tokens; mandate.pools = pools; mandate.fundingAmount = amount;
        mandate.durationSeconds = duration; mandate.setupDeadline = uint64(block.timestamp + 5 minutes);
        mandate.policyVersion = 1; mandate.nonce = factory.enrollmentNonce(owner_);
        bytes32 digest = factory.mandateDigest(mandate);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _enroll(uint256 ownerKey, uint256 amount, uint64 duration, uint256 authNonce)
        internal returns (PerpVault vault)
    {
        (AutonomyTypes.CircleAuthorization memory auth, PerpMandate.Mandate memory mandate,
            bytes memory signature) = _prepare(ownerKey, amount, duration, authNonce);
        vault = PerpVault(factory.createAndEnroll(auth, mandate, signature));
    }

    function _market(PerpVault vault, bytes32 orderId, uint8 index, bool isLong,
        uint8 leverage, uint256 margin) internal
    {
        uint256 mark = clearinghouse.currentPrice(index);
        vm.prank(OPERATOR);
        vault.submitEntry(orderId, index, isLong, leverage, margin, 0, mark, uint64(block.timestamp + 30));
    }

    function _movePriceUp(uint8 index, uint256 amountUsdc) internal {
        vm.prank(OPERATOR); circle.approve(pools[index], amountUsdc);
        vm.prank(OPERATOR); MoeaziTestPairPool(pools[index]).swap(USDC, tokens[index], amountUsdc, 1);
    }

    function _movePriceDown(uint8 index, uint256 amountToken) internal {
        vm.prank(OPERATOR); FixedSupplyMockToken(tokens[index]).approve(pools[index], amountToken);
        vm.prank(OPERATOR); MoeaziTestPairPool(pools[index]).swap(tokens[index], USDC, amountToken, 1);
    }

    function _signStop(PerpVault vault, uint256 ownerKey, uint256 nonce) internal returns (bytes memory sig) {
        uint64 deadline = uint64(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, vault.stopDigest(nonce, deadline));
        sig = abi.encodePacked(r, s, v);
    }

    function _signStopAt(PerpVault vault, uint256 ownerKey, uint256 nonce, uint64 deadline)
        internal returns (bytes memory sig)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, vault.stopDigest(nonce, deadline));
        sig = abi.encodePacked(r, s, v);
    }
}
