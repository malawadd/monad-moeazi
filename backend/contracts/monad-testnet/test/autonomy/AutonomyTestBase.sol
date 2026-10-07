// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "../TestBase.sol";
import {MonadTestnetRegistry} from "../../src/MonadTestnetRegistry.sol";
import {AutonomyTypes} from "../../src/autonomy/AutonomyTypes.sol";
import {AutonomyMandate} from "../../src/autonomy/AutonomyMandate.sol";
import {FixedSupplyMockToken} from "../../src/autonomy/FixedSupplyMockToken.sol";
import {MoeaziTestPairPool} from "../../src/autonomy/MoeaziTestPairPool.sol";
import {AutonomousVaultFactory} from "../../src/autonomy/AutonomousVaultFactory.sol";
import {MoeaziAutonomousVault} from "../../src/autonomy/MoeaziAutonomousVault.sol";
import {MockCircleUSDC} from "./MockCircleUSDC.sol";

abstract contract AutonomyTestBase is TestBase {
    struct PrepareOptions {
        uint256 ownerKey;
        uint256 fundingAmount;
        uint64 duration;
        uint16 buySlip;
        uint16 sellSlip;
        uint256 authNonce;
    }

    uint256 internal constant OWNER_KEY = 0xA11CE;
    address internal constant OPERATOR = address(0xB0B);
    address internal constant USDC = MonadTestnetRegistry.USDC;
    MockCircleUSDC internal circle;
    address[3] internal tokens;
    address[3] internal pools;
    AutonomousVaultFactory internal factory;

    function setUp() public virtual {
        vm.etch(USDC, type(MockCircleUSDC).runtimeCode);
        circle = MockCircleUSDC(USDC);
        circle.mint(OPERATOR, 1_000e6);
        for (uint8 i; i < 3; ++i) {
            FixedSupplyMockToken token = new FixedSupplyMockToken("Test Token", "MOE", OPERATOR, 1_000_000 ether);
            MoeaziTestPairPool pool = new MoeaziTestPairPool(OPERATOR, USDC, address(token));
            vm.prank(OPERATOR);
            circle.approve(address(pool), 100e6);
            vm.prank(OPERATOR);
            token.approve(address(pool), 100_000 ether);
            vm.prank(OPERATOR);
            pool.addLiquidity(100e6, 100_000 ether);
            tokens[i] = address(token);
            pools[i] = address(pool);
        }
        factory = new AutonomousVaultFactory(OPERATOR, OPERATOR, USDC, tokens, pools);
        vm.prank(OPERATOR);
        factory.setEnrollmentEnabled(true);
    }

    function _prepare(uint256 ownerKey, uint256 fundingAmount, uint64 duration,
        uint16 buySlip, uint16 sellSlip, uint256 authNonce)
        internal returns (AutonomyTypes.CircleAuthorization memory auth,
            AutonomyMandate.StrategyMandate memory mandate, bytes memory mandateSignature)
    {
        PrepareOptions memory options = PrepareOptions(
            ownerKey, fundingAmount, duration, buySlip, sellSlip, authNonce
        );
        return _prepareForFactory(factory, pools, options);
    }

    function _prepareForFactory(AutonomousVaultFactory targetFactory, address[3] memory targetPools,
        PrepareOptions memory options)
        internal returns (AutonomyTypes.CircleAuthorization memory auth,
            AutonomyMandate.StrategyMandate memory mandate, bytes memory mandateSignature)
    {
        address owner_ = vm.addr(options.ownerKey);
        circle.mint(owner_, options.fundingAmount);
        auth = _authorization(options.ownerKey, options.fundingAmount, options.authNonce, targetFactory);
        mandate = _mandate(owner_, auth.to, options.fundingAmount, options.duration,
            options.buySlip, options.sellSlip,
            targetFactory, targetPools);
        mandateSignature = _signMandate(options.ownerKey, mandate, targetFactory);
    }

    function _authorization(uint256 ownerKey, uint256 fundingAmount, uint256 authNonce,
        AutonomousVaultFactory targetFactory)
        private returns (AutonomyTypes.CircleAuthorization memory auth)
    {
        address owner_ = vm.addr(ownerKey);
        auth.from = owner_;
        auth.to = targetFactory.predictVault(owner_, targetFactory.enrollmentNonce(owner_));
        auth.value = fundingAmount;
        auth.validAfter = block.timestamp - 1;
        auth.validBefore = block.timestamp + 5 minutes;
        auth.nonce = bytes32(authNonce);
        bytes32 authDigest = circle.authorizationDigest(auth.from, auth.to, auth.value,
            auth.validAfter, auth.validBefore, auth.nonce);
        (auth.v, auth.r, auth.s) = vm.sign(ownerKey, authDigest);
    }

    function _mandate(address owner_, address vault_, uint256 fundingAmount, uint64 duration,
        uint16 buySlip, uint16 sellSlip, AutonomousVaultFactory targetFactory,
        address[3] memory targetPools)
        private view returns (AutonomyMandate.StrategyMandate memory mandate)
    {
        mandate.chainId = MonadTestnetRegistry.CHAIN_ID;
        mandate.owner = owner_;
        mandate.vault = vault_;
        mandate.usdc = USDC;
        for (uint8 i; i < 3; ++i) {
            mandate.tokens[i] = tokens[i];
            mandate.pools[i] = targetPools[i];
        }
        mandate.fundingAmount = fundingAmount;
        mandate.durationSeconds = duration;
        mandate.startBy = uint64(block.timestamp + 5 minutes);
        mandate.maxCycles = 3;
        mandate.buySlippageBps = buySlip;
        mandate.sellSlippageBps = sellSlip;
        mandate.nonce = targetFactory.enrollmentNonce(owner_);
    }

    function _signMandate(uint256 ownerKey, AutonomyMandate.StrategyMandate memory mandate,
        AutonomousVaultFactory targetFactory) private returns (bytes memory)
    {
        bytes32 digest = targetFactory.mandateDigest(mandate);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _enroll(uint256 ownerKey, uint256 fundingAmount, uint64 duration,
        uint16 buySlip, uint16 sellSlip, uint256 authNonce)
        internal returns (MoeaziAutonomousVault vault, AutonomyTypes.CircleAuthorization memory auth,
            AutonomyMandate.StrategyMandate memory mandate, bytes memory signature)
    {
        (auth, mandate, signature) = _prepare(ownerKey, fundingAmount, duration, buySlip, sellSlip, authNonce);
        address created = factory.createAndEnroll(auth, mandate, signature);
        vault = MoeaziAutonomousVault(created);
    }

    function _quote(address pool, address tokenIn, address tokenOut, uint256 amountIn)
        internal view returns (uint256 amountOut)
    {
        bool available;
        (amountOut, available) = MoeaziTestPairPool(pool).quoteExactInput(tokenIn, tokenOut, amountIn);
        assertTrue(available);
    }

    function _receiveCircleAuth(AutonomyTypes.CircleAuthorization memory auth) internal {
        circle.receiveWithAuthorization(auth.from, auth.to, auth.value, auth.validAfter,
            auth.validBefore, auth.nonce, auth.v, auth.r, auth.s);
    }
}
