# Monad testnet contract ABI

Chain ID is `10143`. The vault and adapters use Circle testnet USDC
`0x534b2f3A21130d7a60830c2Df862319e593943A3` and canonical Monad WMON
`0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541`.

## Vault

Constructor: `MoeaziTestnetVault(address owner, address executor, address[] initialAdapters)`.

Wallet calls (owner only):

- `deposit(address asset, uint256 amount)` — owner approves the vault first.
- `withdraw(address asset, uint256 amount)`
- `setExecutor(address executor)`; zero disables managed execution.
- `setAdapterAllowed(address adapter, bool allowed)`
- `revokeMandate()`, `stop()`, `resume()`

Mandate tuple order and Solidity types:

```solidity
struct Mandate {
    uint256 chainId;
    address vault;
    address[] allowedAdapters;
    address tokenIn;
    address tokenOut;
    uint256 maxInputPerTrade;
    uint256 maxTotalInput;
    uint64 validAfter;
    uint64 expiresAt;
    uint256 nonce;
}
```

EIP-712 domain is name `Moeazi Monad Testnet Vault`, version `1`, chain ID
`10143`, verifying contract equal to the vault. `authorizeMandate(Mandate,bytes)`
accepts an owner EOA signature or ERC-1271 contract signature. The pair is ordered;
the caps are smallest raw units of `tokenIn`. A mandate is limited to seven days,
one pair, at most four adapters, and the current `mandateNonce()`.

[The cross-language vector](test/mandate-vector.json) uses the exact tuple above,
two `allowedAdapters` entries, chain `10143`, and `viem`'s `hashTypedData`. Its
digest is `0xda907f731b85cc6eead3a98fdba7d935daaff3a507624cbb5877da416e3b2602`;
`MandateDigestVector.t.sol` asserts the Solidity result against that vector.

Executor call:

```solidity
executeMandatedSwap(bytes32 orderId, address adapter, uint256 amountIn,
    uint256 minAmountOut, bytes venueData) returns (uint256 amountOut)
```

The executor cannot withdraw, change the executor, authorize/revoke a mandate, or
call arbitrary targets. Each nonzero `orderId` is accepted once across the vault's
lifetime. The vault checks the live mandate, adapter allowlists, pair, expiry,
per-trade cap, cumulative cap, exact input balance change, and minimum output.

Useful reconciliation views: `owner()`, `executor()`, `mandateNonce()` (next
nonce), `activeMandateNonce()`, `activeMandateHash()`, `mandateActive()`,
`stopped()`, `mandateUsed(uint256)`, `executedOrder(bytes32)`,
`isMandateActive(bytes32)`, and `activeAdapters()`.

## Venue adapter interface

```solidity
quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn, bytes venueData)
    returns (uint256 amountOut, bool available)
swap(address tokenIn, address tokenOut, uint256 amountIn,
    uint256 minAmountOut, bytes venueData) returns (uint256 amountOut)
```

`venueData` must be empty for these fixed-pair adapters. Quote is non-view to match
the v4 Quoter ABI; applications should call it with `eth_call`. For a manual wallet
swap, approve the chosen adapter for the exact input and call `swap`; output is sent
back to the caller. The vault uses the same call path after mandate authorization.

### Moeazi test AMM

Constructor: `MoeaziTestAmmAdapter(address owner)`. Owner seeds and withdraws
liquidity with `addLiquidity(uint256 usdcAmount,uint256 wmonAmount)` and
`removeLiquidity(uint256 usdcAmount,uint256 wmonAmount)`. Later liquidity must
preserve the initial reserve ratio. It is a small constant-product test venue with
30 bps fee and no price oracle.

### Uniswap v4 no-hook venue

`UniswapV4NoHookAdapter()` uses the fixed community PoolManager, Quoter, canonical
USDC/WMON pair, fee `3000`, tick spacing `60`, and zero hooks. `quoteExactInput`
returns unavailable if that exact pool is uninitialized, the Quoter reverts, or
there is no positive quote. `swap` settles directly through PoolManager unlock and
does not use the Universal Router.

`V4NoHookPoolSeeder(address owner)` can initialize once with
`initializeAndSeed(uint160 sqrtPriceX96,uint256 usdcAmount,uint256 wmonAmount)`,
add full-range liquidity with `seedExisting(uint256,uint256)`, or remove its
position liquidity with `removeLiquidity(uint128)`. The owner must approve and
hold both assets. `sqrtPriceX96ForWmonPerUsdc(uint256 priceWad)` accepts an
18-decimal human WMON-per-USDC price. For parity, `priceWad=1e18` returns
`1_000_000 * 2**96`; `2**96` would price equal raw token units and skew the human
price by `1e12` due to token decimals. Select and review the initial price before
broadcasting; the seeder does not choose a price or add liquidity automatically.

## Autonomous testnet enrollment

These contracts are separately deployed for the autonomous testnet flow. The
factory and vault enforce chain `10143` and canonical Circle test USDC. Enrollment
is disabled in the constructor and must remain disabled until the supervisor
verifies deployment receipts and enables the testnet autonomy gate.

Factory constructor:

```solidity
AutonomousVaultFactory(
    address administrator, address executor, address usdc,
    address[3] tokens, address[3] pools
)
```

The ordered pairs are `MZA`, `MZB`, `MZG`. `createAndEnroll(CircleAuthorization,
StrategyMandate,bytes)` creates a deterministic vault using `CREATE2`, then calls
Circle's `receiveWithAuthorization` from that vault in the same transaction.
Circle authorization tuple order is:

```solidity
struct CircleAuthorization {
    address from;
    address to;
    uint256 value;
    uint256 validAfter;
    uint256 validBefore;
    bytes32 nonce;
    uint8 v;
    bytes32 r;
    bytes32 s;
}
```

Circle EIP-712 domain: name `USDC`, version `2`, chain `10143`, verifying
contract Circle test USDC. Primary type `ReceiveWithAuthorization` has fields
`from,address`; `to,address`; `value,uint256`; `validAfter,uint256`;
`validBefore,uint256`; `nonce,bytes32`. The payee is the predicted vault, so only
the vault's atomic call can consume this authorization.

The strategy EIP-712 domain is name `Moeazi Monad Testnet Autonomy`, version `1`,
chain `10143`, verifying contract the predicted vault. Primary type
`StrategyMandate` uses this exact field order and Solidity types:

```solidity
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
```

Funding is `100_000`–`10_000_000` raw USDC units; duration is 600–7200 seconds;
setup deadline is at most five minutes; `maxCycles` must equal three; each
slippage bound is at most 500 bps. Expiry is the actual atomic activation time
plus the signed duration. A new enrollment gets a separate vault and owner nonce.

Executor calls:

```solidity
buy(bytes32 orderId, uint8 tokenIndex, uint256 amountIn, uint256 expectedAmountOut)
sell(bytes32 orderId, uint256 expectedAmountOut)
settleExpired(bytes32 sellOrderId, uint256 expectedAmountOut)
```

Each buy is capped at the original funding amount, only one position can be
open, and each order ID executes once. Quotes are fee-inclusive executable pool
quotes; the contract rejects zero/stale quotes or a caller-supplied quote outside
the owner's signed slippage bound. Sells remain permitted after expiry, while new
buys are blocked. After cycle three or an expiry sale, all assets are returned.
If an expiry sale cannot quote or execute, the vault returns residual USDC and
the unsold mock token with `Incomplete` status. Only the owner may call
`emergencyRecover()` during an active run. The executor has no withdrawal call.

`MoeaziTestPairPool` exposes `quoteExactInput(tokenIn,tokenOut,amountIn)`,
`quoteSpotExactInput(...)`, `swap(tokenIn,tokenOut,amountIn,minAmountOut)`,
`getReserves()`, and `spotPriceUsdcPerTokenWad()`. Pool swaps emit `Swap` with
caller, direction, input, and output. There is no liquidity removal or owner
withdrawal method. Additional liquidity can only be added at the current reserve
ratio. Seed liquidity is 6 USDC and 6,000 tokens per pool; pools charge 30 bps.
The operator owns the fixed token supply and moves prices with funded swaps.

Generated compact ABIs are under [`abi/`](abi/). The cross-language mandate
vector is [here](test/autonomy/mandate-vector-autonomy.json), with its Solidity
assertion in `test/autonomy/AutonomyMandateDigestVector.t.sol`. The separate
deployment manifest uses `deployments/manifest.autonomy.schema.json`; it records
all 16 deployment, approval, and pool-seed transaction receipts.

## Mock Perp autonomy (policy version 1)

This separate test-only venue is on chain `10143`, collateral is Circle test USDC, and
markets `0..2` are the ordered MZA, MZB, MZG pools pinned at deployment. The clearinghouse
uses each pool's onchain `spotPriceUsdcPerTokenWad()` as its mark. No Perpl order is sent.
The factory constructor leaves `enrollmentEnabled=false`; enable only after deployment
review. Funding limits are `100_000..10_000_000` raw USDC (0.1..10 USDC), duration is
10..120 minutes, policy version is `1`; one active run per owner. Leverage is 1..10x,
position margin cannot exceed the run's original funding, and the clearinghouse commits
4x extra reserve before entry to guarantee a 5x total payout cap. Withdrawals can use
only `operatorReserve - reserveCommitted`.

Factory constructor: `PerpVaultFactory(address administrator,address executor,address usdc,
address clearinghouse,address[3] tokens,address[3] pools)`. Clearinghouse constructor:
`PerpClearinghouse(address administrator,address usdc,address[3] tokens,address[3] pools)`.
Call `clearinghouse.setFactory(factory)` once before enrollments. `createAndEnroll(
CircleAuthorization,PerpMandate,bytes)` atomically deploys the predicted CREATE2 vault,
registers it, consumes Circle `receiveWithAuthorization`, and activates the run.

Mandate tuple order and Solidity types:

```solidity
uint256 chainId; address owner; address vault; address usdc;
address clearinghouse; address executor; address[3] tokens; address[3] pools;
uint256 fundingAmount; uint64 durationSeconds; uint64 setupDeadline;
uint8 policyVersion; uint256 nonce;
```

EIP-712 domain: `Moeazi Monad Testnet Perp`, version `1`, chain `10143`, verifying
contract the factory. Primary type string:
`PerpMandate(uint256 chainId,address owner,address vault,address usdc,address clearinghouse,address executor,address[3] tokens,address[3] pools,uint256 fundingAmount,uint64 durationSeconds,uint64 setupDeadline,uint8 policyVersion,uint256 nonce)`.
Each fixed array hashes as `keccak256(abi.encode(array))`. Circle uses the EIP-3009
`ReceiveWithAuthorization` tuple and the existing `USDC` / `2` Circle domain.

Executor calls on the user vault:

```solidity
submitEntry(bytes32 id,uint8 market,bool isLong,uint8 leverage,uint256 margin,
    uint256 limitPrice,uint256 expectedPrice,uint64 validUntil)
fillLimit(bytes32 id); amendLimit(bytes32 id,uint256 limitPrice,uint64 goodUntil);
cancelPending(bytes32 id);
increaseSize(bytes32 id,uint256 margin,uint256 expectedPrice,uint64 validUntil);
reduceSize(bytes32 id,uint256 sizeWad,uint256 expectedPrice,uint64 validUntil);
addMargin(bytes32 id,uint256 amount,uint256 expectedPrice,uint64 validUntil);
removeMargin(bytes32 id,uint256 amount,uint256 expectedPrice,uint64 validUntil);
setTriggers(bytes32 id,uint256 takeProfitWad,uint256 stopLossWad);
accrueFunding(bytes32 id);
closePosition(bytes32 id,uint256 expectedPrice,uint64 validUntil);
executeTrigger(bytes32 id,uint256 expectedPrice,uint64 validUntil);
liquidate(bytes32 id); settleExpired(bytes32 id);
stopWithSignature(uint256 nonce,uint64 deadline,bytes signature);
```

For market actions, `limitPrice=0`, `expectedPrice` is the recently sampled WAD pool mark,
and `validUntil` must be in `[now,now+30s]`; onchain deviation must be <=1%. Limit entry
uses `limitPrice != 0`, `expectedPrice=0`, and `validUntil` no later than run expiry. Routine
close/resize/margin changes require this quote bound. Trigger, expiry, liquidation and stop
settlement use the live onchain pool mark. `increaseSize` and `addMargin` preserve
`currentMargin + addedMargin <= fundedAmount`; `removeMargin` preserves <=10x effective
notional leverage and maintenance margin.

Stop EIP-712 domain is `Moeazi Monad Testnet Perp Vault`, version `1`, chain `10143`,
verifying contract the vault. Type is `Stop(address vault,address owner,uint256 nonce,uint64 deadline)`.
`stopNonce()` starts at 0; `stopDigest(nonce,deadline)` returns the digest. Deadline must be
within five minutes and nonce exact. Stop is relayed by the executor and returns remaining
vault USDC to the owner.

Useful reads: factory `predictVault`, `activeVault`, `enrollmentNonce`; clearinghouse
`currentPrice`, `position`, `pendingOrder`, `currentMargin`, `operatorReserve`,
`reserveCommitted`, `userCollateralTotal`, `openPositionCount`, `fundingRateBpsPerDay`;
vault `fundedAmount`, `expiresAt`, `status`, `availableUsdc`, `stopNonce`, `usedOrderId`.
Key clearinghouse events: `EntrySubmitted`, `LimitFilled`, `PositionChanged`,
`FundingAccrued`, `PositionClosed(vault,orderId,marketIndex,isLong,sizeWad,entryPriceWad,
exitPriceWad,realizedPnlUsdc,fundingUsdc,returnedUsdc,reason)`, `Liquidated`,
`EntryCancelled`, and `TriggersChanged`. Vault events `SettlementReturned`, `Stopped`,
and `RunExpired` record terminal return. Funding rate updates are blocked while any
position is open, so a rate change cannot retroactively alter accrued time.
