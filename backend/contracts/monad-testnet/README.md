# Moeazi Monad testnet contracts

This isolated Foundry project targets Monad Testnet (`10143`). It contains an
owner-controlled USDC/WMON vault, a small owner-seeded constant-product test AMM,
and a no-hook Uniswap v4 adapter for the community PoolManager registry.

The executor has no withdrawal or arbitrary-call method. It can only submit a
unique order ID through an enabled adapter while a signed, unexpired owner
mandate permits that adapter, pair, per-trade input, and total input. The owner
can revoke a mandate or stop trading at any time. Both adapters support manual
wallet swaps with exact input approval and send output to the caller.

## Build and tests

Run from this directory with the project-local Foundry v1.8.4 binary:

```powershell
& "../../.data/foundry-v1.8.4/bin/forge.exe" build
& "../../.data/foundry-v1.8.4/bin/forge.exe" test --network monad
& "../../.data/foundry-v1.8.4/bin/forge.exe" test --network monad `
  --fork-url https://testnet-rpc.monad.xyz --match-contract MonadV4ForkTest
```

`VaultAndAmm.t.sol` uses local test tokens etched at the canonical token addresses
to test vault custody, signatures, caps, replay protection, stop/revoke behavior,
and manual swaps in both directions. Its EIP-712 digest check is pinned to the
cross-language viem vector in `test/mandate-vector.json`. `MonadV4Fork.t.sol` reads
the actual Monad testnet pool state on the fork command and requires positive
quotes both ways only when the pool has active liquidity; it never seeds, swaps,
or broadcasts. Without a fork, that test checks local decimal-price math only.

The v4 USDC/WMON pool was initialized and seeded on Monad Testnet with real
testnet assets at an initial human price of 0.1 WMON per USDC. Its pool ID,
code hashes, liquidity, and receipts are in the
[verified manifest](deployments/manifest.testnet.json). The adapter returns
`(0,false)` if this pool later lacks executable liquidity. Fee `3000` and tick
spacing `60` identify its pool key. For a new pool, choose the initial human
WMON-per-USDC price explicitly; the tokens use 6 and 18 decimals.

## Deployment scripts

Scripts only create contracts or seed liquidity when explicitly broadcast by the
supervising operator. The deploy script requires these environment values:

| Variable | Meaning |
| --- | --- |
| `MONAD_OWNER_ADDRESS` | Mera wallet that owns the vault and signs mandates |
| `MONAD_EXECUTOR_ADDRESS` | Operator allowed to submit mandated swaps; zero disables execution |
| `MONAD_OPERATOR_ADDRESS` | Owner of the AMM liquidity and v4 seeder |
| `MONAD_SOURCE_REVISION` | Source revision identifier to put in the draft manifest |
| `MONAD_DEPLOYMENT_MANIFEST` | Local path for the draft manifest output |

After setting a secured Foundry signer and `MONAD_TESTNET_RPC_URL`, run:

```powershell
& "../../.data/foundry-v1.8.4/bin/forge.exe" script script/DeployMonadTestnet.s.sol `
  --rpc-url $env:MONAD_TESTNET_RPC_URL --broadcast
```

The script creates the AMM adapter, v4 adapter, v4 seeder, and vault with both
adapters enabled. It does not initialize a pool or seed the AMM. It writes a draft
manifest with addresses, onchain code hashes, source/toolchain pin, and observed
v4 pool state. Deployment transaction hashes remain explicitly pending until the
supervisor verifies Foundry receipts and updates the manifest status.

`SeedMoeaziAmm.s.sol` requires `MONAD_TESTNET_AMM_ADAPTER_ADDRESS`,
`MONAD_USDC_SEED_AMOUNT`, and `MONAD_WMON_SEED_AMOUNT`. It must be broadcast by
the AMM owner and that account must hold both tokens.

`SeedV4NoHookPool.s.sol` requires `MONAD_TESTNET_V4_SEEDER_ADDRESS`,
`MONAD_USDC_SEED_AMOUNT`, and `MONAD_WMON_SEED_AMOUNT`. If the pool is not
initialized, it also requires `MONAD_V4_INITIAL_PRICE_WAD`; if it already exists,
the script adds to its current price. The seeder owner must hold and approve both
tokens. No script fabricates reserves or substitutes mock liquidity on Monad.

See [ABI.md](ABI.md) for exact constructors, mandate fields, getters, and wallet
call shapes. `deployments/manifest.schema.json` defines the deployment manifest;
the example contains placeholders and is not evidence of a deployment.
