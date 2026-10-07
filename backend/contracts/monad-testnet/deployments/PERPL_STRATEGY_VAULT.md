# Perpl Testnet strategy vault

## Network and status

- Chain: Monad Testnet, `10143`.
- AUSD: `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, 6 decimals.
- Perpl delegated-account factory: `0xf42548Ccb3300Bc76c35dc2D347416db2E8d7209`.
- Perpl exchange: `0x1964C32f0bE608E7D29302AFF5E61268E72080cc`.
- Moeazi factory: `0xCF0fd3c3FEd28d40bd739FcE26FD7CC7d923b80e`, deployed in block `68999783` and verified in `manifest.perpl.strategy.testnet.json`.
- The enrollment gate starts off. Direct transport does not depend on Perpl API Origin approval or API-key enrollment.

The factory constructor validates chain 10143, external contract code, AUSD decimals, and the exchange's current collateral token and decimals. On 2026-10-07, the factory and an owner vault were deployed, a 100 AUSD direct run completed three BTC cycles, and 99.732661 AUSD returned. The final onchain factory enrollment gate is off; the [acceptance report](../../../../docs/PERPL_TESTNET_REPORT.html) records receipts and measured balances.

## Factory and vault ABI

Full machine-readable ABIs are `../abi/PerplStrategyVaultFactory.json` and `../abi/PerplStrategyVault.json`.

Factory constructor and core calls:

```solidity
constructor(address administrator, address operator)
predictVault(address owner) view returns (address)
createVault(address owner) returns (address vault)
vaultFor(address owner) view returns (address)
mandateNonce(address owner) view returns (uint256)
mandateDigest(PerplStrategyMandate.Mandate) view returns (bytes32)
activateRun(Mandate, bytes ownerSignature, uint256 operatorDeadline, bytes operatorSignature)
    returns (address vault) // operator only; enrollment gate must be on
setEnrollmentEnabled(bool enabled) // administrator only
```

The vault owner calls `requestStop()`. After the backend cancels/reconciles
orders and closes positions, the configured operator calls
`markSettlementReady(bytes32 accountStateHash)`, then the owner or operator
calls `completeSettlement(uint256 withdrawAmount)`. The vault checks Perpl's
account balance, locked balance, position bitmap and order locks before marking
ready and checks the balance again before withdrawal. The backend must also
reconcile orders accepted for forwarding but not yet reflected onchain.

`recoverWithdrawCollateral(uint256)` is owner-only once stopped, expired,
settlement-ready, or settled. It first verifies there are no Perpl positions,
locked funds, or order locks, then disables forwarding and removes the operator
before withdrawing. Passing `0` disables trading without withdrawing from Perpl;
any AUSD already held by the vault is still returned. Otherwise, the amount must
not exceed the fresh free balance. `recoverRescueAUSD(uint256)`,
`revokeOperator()`, and `setForwardingForRecovery(false)` are additional owner
recovery controls.

## Signed run mandate

The Mera owner signs EIP-712 domain `Moeazi Perpl Strategy Vault`, version `2`,
chain 10143, verifying contract equal to the deterministic owner vault. The
type string is:

```text
PerplRunMandate(uint256 chainId,address owner,address vault,address collateralToken,address operator,uint8 transport,uint256 fundingAmount,uint256 maxPositionExposure,uint8 maxLeverage,uint64 durationSeconds,uint64 setupDeadline,uint8 policyVersion,uint256 nonce,uint256[] marketIds)
```

Transport is pinned in the owner-signed mandate: `1` is direct onchain and `2`
is API order forwarding. Direct activation enables the Perpl delegated account's
`execOrder` and `execOrders` operator selectors, and leaves API forwarding off.
API transport retains the existing forwarding setup for a future API run. Each
active run stays on its selected transport until settlement.

`fundingAmount` and `maxPositionExposure` are AUSD base units. The vault binds
the market list, funding amount, exposure, leverage, duration and policy version
to each sequential nonce. The signed exposure cannot exceed funding multiplied
by the signed leverage. These per-order/per-run trading limits are not enforced
by Perpl's contracts; enforce them in the backend for both transports.

## Direct execution ABI

The operator sends the Exchange `execOrder` calldata to the user's delegated
account proxy. The delegated account checks the operator and selector allowlist,
then forwards to the Exchange. Sending the same call directly to the Exchange
from the operator EOA fails with `AccountDoesNotExist(operator)`.

`OrderDesc` tuple order is:

```text
(uint256 orderDescId,uint256 perpId,uint8 orderType,uint256 orderId,uint256 pricePNS,uint256 lotLNS,uint256 expiryBlock,bool postOnly,bool fillOrKill,bool immediateOrCancel,uint256 maxMatches,uint256 leverageHdths,uint256 lastExecutionBlock,uint256 amountCNS,uint256 maxNegPnlCollatBPS)
```

Order types are `0 OpenLong`, `1 OpenShort`, `2 CloseLong`, `3 CloseShort`,
`4 Cancel`, `5 IncreasePositionCollateral`, and `6 Change`. The direct path
uses `execOrder` selector `0x4d8dc985`; batch calls use `execOrders` selector
`0x39435dac`. IOC orders use `expiryBlock=0`, `postOnly=false`,
`fillOrKill=false`, `immediateOrCancel=true`, `maxMatches=0`, and
`lastExecutionBlock=0`. Market prices are slippage bounds; they are not fill
prices.

For live `OrderRequestV2`, all fields are non-indexed. Its signature is
`OrderRequestV2(uint256,uint256,uint256,uint256,uint8,uint256,uint256,uint256,bool,bool,bool,uint256,uint256,uint256,uint256,uint256,uint256,bytes)`.
Finalized `TakerOrderFilledV2` signature is
`TakerOrderFilledV2(uint256,uint256,uint256,uint256,uint256,int256,uint256,uint256,uint256)`;
its `feeCNS` is gross, including any builder fee. `getOrder(perpId,orderId)`
returns `(uint32 accountId,uint8 orderType,uint24 priceONS,uint40 lotLNS,
uint16 recycleFeeRaw,uint32 expiryBlock,uint16 leverageHdths,uint16 orderId,
uint16 prevOrderId,uint16 nextOrderId,uint16 maxNegPnlCollatBPS)`.
Read orders, positions and balances at finalized blocks; do not treat submission
or an `OrderRequest` event as a fill.

## Perpl operator signature

On first activation, the strategy vault calls Perpl factory
`create(operator, deadline, signature)`. The operator signature is EIP-712
domain `DelegatedAccountFactory`, version `1`, chain 10143, verifying contract
the Perpl factory; type:

```text
AssignOperator(address owner,uint256 nonce,uint256 deadline)
```

Here `owner` is the predicted strategy vault, and `nonce` is Perpl factory
`operatorNonces(operator)`. After settlement revokes the operator, a later run
uses the same type under domain `DelegatedAccount`, version `1`, verifying
contract the existing delegated account; its nonce is the account's
`operatorNonces(operator)`.

The delegated account's Perpl factory creation and later operator permissions
remain subject to Perpl's deployed implementation and allowlist. The Moeazi
operator cannot call withdrawal wrappers; only the strategy vault can.

## Prefunding recovery

Mobile may transfer AUSD to `predictVault(owner)` before activating a run. If
the activation transaction reverts, the separate AUSD transfer remains at that
counterfactual address. Anyone can then call `createVault(owner)` to deploy the
same deterministic vault; only its owner can call `recoverVaultFunding()` to
return the idle AUSD. The owner may instead retry a corrected signed activation,
which consumes the existing balance. A reverted activation does not consume
the mandate nonce or partially create the delegated account.

## Deployment procedure

Use `script/DeployPerplStrategyVaultTestnet.s.sol`. It requires chain 10143,
the existing Testnet action, broadcast and operator-trade gates plus
`MONAD_TESTNET_PERPL_DIRECT_EXECUTION_ENABLED=true`; live execution and mainnet
venue setup gates must remain false. Direct trading also requires the separate
`MONAD_TESTNET_PERPL_AUTONOMY_ENABLED` and direct execution gates in the API
runtime. All funded gates start off.
It reads `MONAD_PERPL_ADMINISTRATOR_ADDRESS`,
`MONAD_PERPL_OPERATOR_ADDRESS`, and `MONAD_SOURCE_REVISION`, deploys with the
enrollment gate off, and writes a draft receipt manifest under ignored
`backend/.data/`. Origin approval and API-key enrollment are not prerequisites
for direct runs. Review the deployment and exact transaction before broadcast.

From `backend/contracts/monad-testnet`, the broadcast command is:

```powershell
& "../../.data/foundry-v1.8.4/bin/forge.exe" script `
  script/DeployPerplStrategyVaultTestnet.s.sol `
  --rpc-url $env:MONAD_TESTNET_RPC_URL --broadcast
```

It reads `MONAD_PERPL_ADMINISTRATOR_ADDRESS`,
`MONAD_PERPL_OPERATOR_ADDRESS`, and `MONAD_SOURCE_REVISION`. Use a secured
Foundry signer and keep its key out of command history and manifests. The
script also requires `MONAD_TESTNET_ACTIONS_ENABLED`,
`MONAD_TESTNET_BROADCAST_ENABLED`, `MONAD_TESTNET_OPERATOR_TRADES_ENABLED`, and
`MONAD_TESTNET_PERPL_DIRECT_EXECUTION_ENABLED`; it refuses live-execution and
mainnet-venue gates. The generated draft is
`backend/.data/perpl-strategy-manifest.draft.json`.

Before promoting that draft, validate it against
`manifest.perpl.strategy.schema.json`; check each Foundry receipt is successful
on chain 10143 and its factory address matches the draft; compare deployed
runtime code hashes with the draft; and read back the factory administrator,
operator, and `enrollmentEnabled=false`. Only then copy verified addresses,
hashes, source revision, and deployment receipt into
`manifest.perpl.strategy.testnet.json` and set its verified fields. Leave the
enrollment gate off until a separate activation review.

The direct fork test and compatibility test use local fork state only:

```powershell
forge test --fork-url https://testnet-rpc.monad.xyz --match-contract PerplStrategyForkCompatibilityTest
forge test --fork-url https://testnet-rpc.monad.xyz --match-contract PerplDirectExecutionForkTest
```

The direct fork test funds a temporary owner from the test faucet, activates a
direct mandate, and exercises positive-ID IOC long/short entry and close,
`OrderRequestV2` and `TakerOrderFilledV2` decoding, `getOrder`, and post-only
cancel with no remaining order locks. Fork changes are discarded; no Testnet
operator transaction is broadcast. The compatibility test checks the
exchange/AUSD wiring, factory operator signature and account ABI, operator
withdrawal rejection, and read-only `getAccountById`/`getOrderLocks` probes.
