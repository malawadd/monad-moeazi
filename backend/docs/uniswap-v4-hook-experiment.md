# Uniswap v4 hook experiment

## Decision

Moeazi uses two separate Uniswap lanes:

1. The existing Trading API lane remains the default for V2, V3, V4, and
   UniswapX best-price routing.
2. An explicitly configured v4 hook-pool lane provides a quote and simulation
   comparison for one USDC/WETH pool. It is never selected or broadcast.

A v4 hook is attached when a pool is initialized. It cannot wrap arbitrary
Trading API routes, so it does not replace quote freshness, deterministic
policy, UA authorization, simulation, or receipt reconciliation.

## Implemented experiment

`contracts/uniswap-v4-hooks/` contains `MoeaziRiskGuardHook`, an immutable
reference hook that:

- permits exactly one PoolId;
- caps the specified currency amount in both directions;
- supports `beforeSwap` and `afterSwap` only;
- emits a normalized observation event;
- performs no external calls, token custody, fee override, or custom accounting.

The hook address must encode exactly the v4 `beforeSwap` and `afterSwap` flags.
The sidecar also requires the deployed runtime bytecode hash. A configuration
with extra permission bits or a mismatched code hash fails closed.

The quote path is:

```text
Portal
  -> Python /v1/swap/hook-quote
  -> TypeScript sidecar
  -> verify hook address, flags, bytecode, and USDC/WETH PoolKey
  -> official Arbitrum V4Quoter
  -> construct Universal Router V4_SWAP locally
  -> attest PoolId, hook code hash, and config hash
  -> eth_call
  -> return comparison with broadcastAllowed=false
```

The official Arbitrum contracts used by the experiment are:

| Contract | Address |
| --- | --- |
| PoolManager | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` |
| V4Quoter | `0x3972c00f7ed4885e145823eb7c655375d275a1c5` |
| Universal Router | `0xa51afafe0263b40edaef0df8781ea9aa03e381a3` |
| Permit2 | `0x000000000022d473030f116ddee9f6b43ac78ba3` |

## Configuration

Defaults keep the lane isolated:

```text
UNISWAP_HOOK_EXPERIMENT_ENABLED=false
UNISWAP_HOOK_ADDRESS=
UNISWAP_HOOK_CODE_HASH=
UNISWAP_HOOK_FEE=3000
UNISWAP_HOOK_TICK_SPACING=60
```

An Arbitrum RPC is also required. Enabling the flag without a complete, valid
configuration reports an unavailable comparison rather than weakening checks.

## Options and fit

| Option | Benefit | Integration | Current decision |
| --- | --- | --- | --- |
| Risk guard | On-chain amount/pool invariant | Current experiment | Measure on a fork |
| Dynamic fees | Protect LP inventory during volatility | Extend `beforeSwap` with bounded deterministic data | Only if Moeazi owns liquidity |
| TWAMM/DCA | Trust-minimized scheduled execution | Temporal owns lifecycle; keepers trigger settlement | Defer until signing and reconciliation are certified |
| Conditional orders | On-chain trigger enforcement | Hook-held order plus oracle and refund paths | Defer; high oracle and audit risk |
| Rebates/points | Incentives and attribution | `afterSwap` accounting | Product-dependent |
| Permissioned pool | Restricted liquidity access | Trusted-router sender recovery | Poor fit for public USDC/WETH |
| Observation-only | Exact pool events | Index into Timescale | Optional, low marginal value |
| UA/EIP-7702 guard | Limits every router path | Audited smart-account permission module | Preferred cross-route control; not a v4 hook |

No model or agent worker administers the hook. If dynamic configuration is
explored later, it must use deterministic bounded inputs and an audited
governance boundary.

## Verification

```powershell
forge test --root contracts/uniswap-v4-hooks
npm test
npm --prefix execution-sidecar run typecheck
python -m pytest agent-service/tests/test_uniswap.py
```

The Foundry deployment test only reads an Arbitrum fork when
`ARBITRUM_RPC_URL` is present. It never broadcasts.

## Production blockers

- CREATE2 address mining and reproducible deployment artifacts.
- A seeded-liquidity and routing-economics decision.
- Full fork pool initialization, liquidity, quote, swap, and reconciliation.
- Contract and integration audits.
- Permit2/UA authorization design for direct v4 calldata.
- Receipt indexing and duplicate-safe reconciliation.
- Capped funded canaries and explicit Uniswap venue certification.
