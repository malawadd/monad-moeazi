// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @notice Immutable, fork-only reference hook for Moeazi's v4 integration experiment.
/// @dev The production route stays on Uniswap's Trading API. This hook intentionally
///      performs no external calls, takes no custody, and returns no custom deltas.
contract MoeaziRiskGuardHook is IHooks {
    using BalanceDeltaLibrary for BalanceDelta;
    using PoolIdLibrary for PoolKey;

    error OnlyPoolManager();
    error UnsupportedHookCall();
    error UnexpectedPool(bytes32 actual);
    error SwapLimitExceeded(uint256 requested, uint256 permitted);
    error InvalidAmount();

    event MoeaziSwapObserved(
        bytes32 indexed poolId,
        address indexed router,
        bool zeroForOne,
        int256 amountSpecified,
        int128 amount0,
        int128 amount1,
        bytes32 hookDataHash
    );

    IPoolManager public immutable poolManager;
    bytes32 public immutable permittedPoolId;
    uint128 public immutable maxSpecifiedCurrency0;
    uint128 public immutable maxSpecifiedCurrency1;

    constructor(
        IPoolManager manager,
        bytes32 allowedPoolId,
        uint128 currency0Limit,
        uint128 currency1Limit
    ) {
        poolManager = manager;
        permittedPoolId = allowedPoolId;
        maxSpecifiedCurrency0 = currency0Limit;
        maxSpecifiedCurrency1 = currency1Limit;
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    function beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        _assertPool(key);
        uint256 specifiedAmount = _absolute(params.amountSpecified);
        bool specifiedIsCurrency0 =
            params.amountSpecified < 0 ? params.zeroForOne : !params.zeroForOne;
        uint256 limit = specifiedIsCurrency0
            ? maxSpecifiedCurrency0
            : maxSpecifiedCurrency1;
        if (specifiedAmount > limit) {
            revert SwapLimitExceeded(specifiedAmount, limit);
        }
        return (
            IHooks.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            0
        );
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int128) {
        bytes32 poolId = _assertPool(key);
        emit MoeaziSwapObserved(
            poolId,
            sender,
            params.zeroForOne,
            params.amountSpecified,
            delta.amount0(),
            delta.amount1(),
            keccak256(hookData)
        );
        return (IHooks.afterSwap.selector, 0);
    }

    function _assertPool(PoolKey calldata key) internal view returns (bytes32 id) {
        id = PoolId.unwrap(key.toId());
        if (id != permittedPoolId) revert UnexpectedPool(id);
    }

    function _absolute(int256 amount) internal pure returns (uint256) {
        if (amount == 0 || amount == type(int256).min) revert InvalidAmount();
        return uint256(amount < 0 ? -amount : amount);
    }

    function beforeInitialize(address, PoolKey calldata, uint160)
        external pure returns (bytes4) { revert UnsupportedHookCall(); }
    function afterInitialize(address, PoolKey calldata, uint160, int24)
        external pure returns (bytes4) { revert UnsupportedHookCall(); }
    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external pure returns (bytes4) { revert UnsupportedHookCall(); }
    function afterAddLiquidity(
        address, PoolKey calldata, ModifyLiquidityParams calldata,
        BalanceDelta, BalanceDelta, bytes calldata
    ) external pure returns (bytes4, BalanceDelta) { revert UnsupportedHookCall(); }
    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external pure returns (bytes4) { revert UnsupportedHookCall(); }
    function afterRemoveLiquidity(
        address, PoolKey calldata, ModifyLiquidityParams calldata,
        BalanceDelta, BalanceDelta, bytes calldata
    ) external pure returns (bytes4, BalanceDelta) { revert UnsupportedHookCall(); }
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external pure returns (bytes4) { revert UnsupportedHookCall(); }
    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external pure returns (bytes4) { revert UnsupportedHookCall(); }
}

