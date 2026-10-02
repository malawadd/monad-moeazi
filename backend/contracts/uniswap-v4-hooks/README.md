# Moeazi Uniswap v4 hook experiment

This is a fork-only proof of concept. It does not replace the Uniswap Trading API
route and is not certified for deployment or funded execution.

The hook permits one immutable pool ID, limits the specified currency amount in
both directions, emits a normalized post-swap event, performs no external calls,
and takes no token custody.

Dependencies are pinned by `execution-sidecar/package.json` and its lockfile.

```powershell
forge test --root contracts/uniswap-v4-hooks
```

To verify the official Arbitrum contract deployments without broadcasting:

```powershell
$env:ARBITRUM_RPC_URL="<your Arbitrum RPC>"
forge test --root contracts/uniswap-v4-hooks --match-contract ArbitrumDeploymentsTest
```

Production deployment would additionally require CREATE2 hook-address mining,
an audit, owned-liquidity economics, receipt reconciliation, and explicit venue
certification.
