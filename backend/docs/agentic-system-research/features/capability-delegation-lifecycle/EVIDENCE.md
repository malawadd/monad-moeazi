# Evidence — Capability and Delegation Lifecycle Ledger

## Claim-to-source map

| Claim | Source | Status and limit |
| --- | --- | --- |
| Current capability state is summarized and effective revocation can be unverified | [U19](../../SOURCES.md#unimoazi-sources) | Direct repository evidence |
| EIP-7702 delegation is chain/nonce bound, persistent and clearable with zero target | [S80](../../SOURCES.md#external-sources), [S81](../../SOURCES.md#external-sources) | Protocol/official docs; delegated code has unrestricted root execution |
| Particle and Magic expose UA/7702 capabilities | [S82](../../SOURCES.md#external-sources), [S83](../../SOURCES.md#external-sources) | Provider docs/claims, not least-privilege certification |
| Permit2 supports expiring allowances, nonces and lockdown | [S84](../../SOURCES.md#external-sources), [S85](../../SOURCES.md#external-sources) | Production docs/code; application reconciliation remains required |

## Critical protocol facts

- EIP-7702 permits chain ID zero; Unimoazi forbids it and requires `42161`.
- The delegation indicator is processed before the outer call and persists if that
  call later reverts. Post-state must be observed independently.
- Root delegation has no protocol expiry. Least privilege must be implemented by
  certified delegate code and subordinate modules/sessions/venue grants.
- Logout, routing disablement and emergency stop do not remove onchain or venue rights.
- Permit2 scope does not remove the need to inventory the underlying ERC-20 allowance.

## Counterevidence and limitations

- Some venue/provider APIs may not expose exact effective permissions or reliable
  revocation reads; those capability types remain uncertified.
- Exact allowance can still equal an account's whole balance.
- Revocation needs owner interaction, gas, provider availability and finality; it can
  be partial or unknown.
- Replacement may temporarily overlap old/new authority and requires an explicit cap.
- A certified code hash proves identity, not safety or governance integrity.
- The projected exposure reduction depends on real balances and grant caps.

## Freshness

Sources were checked on 2026-08-05. Wallet/provider/venue APIs, delegate code,
allowances and nonces must be reobserved at every material boundary. Any code, chain,
scope, nonce or revocation-method change creates a new grant/certificate version.
