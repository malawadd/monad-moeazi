# Mock Perp autonomy on Monad Testnet

This feature is a separate choice beside Spot. It uses Circle testnet USDC as
isolated collateral and the MZA, MZB, and MZG USDC pools as onchain price
references. The clearinghouse records synthetic long and short positions; a
Perp fill does not transfer mock tokens to the user. No Perpl account, aUSD,
API key, or Perpl order is involved.

## What the user approves

The user chooses 0.1–10 USDC and 10–120 minutes in **Autonomous Trading →
Perp**. One Mera session signs an exact Circle
`ReceiveWithAuthorization` transfer and a separate version 1 Perp mandate.
The operator relays one atomic factory transaction that deploys this owner's
vault, consumes the transfer authorization, funds the vault, and verifies the
mandate. A failed transaction does not create an active run. An expired
authorization must be prepared and signed again.

The signed policy allows one open position, MZA/MZB/MZG markets, long or short,
1×–10× leverage, and at most the original amount as margin per position.
Loss is limited to the funds in that vault. The margin payout ceiling is 5×,
backed by a 4× operator USDC reserve commitment before each entry. Only
uncommitted reserve is withdrawable. There is no fixed cycle count: positions
may repeat until expiry, owner stop, or exhausted collateral. The operator
pays MON gas; user PnL is displayed in USDC separately. The in-app gas line
totals receipt-verified **vault transactions**; operator pool moves and
reserve management gas are itemized in the acceptance ledger.

The user can inspect submitted, executed, and finalized orders, the open
position, pending limit, equity, PnL, funding, rejections, and returned funds
in Perp status/history and Activity. **Stop** requires a fresh Mera signature;
routine trades do not. At expiry the worker stops new entries, closes any
position, and returns available USDC to the Mera wallet.

## Local setup and test gates

Read [LOCAL_STACK.md](../LOCAL_STACK.md) first. Start the scoped local stack
from `backend/` with `npm run stack:start`; run the app on `Moeazi_API_36` with
`npm run android:preview`. KeePassDX's offline emulator credentials are in
[AGENTS.md](../AGENTS.md). No Google sign-in is needed.

The verified contracts and code hashes are pinned in
[manifest.perp.testnet.json](../backend/contracts/monad-testnet/deployments/manifest.perp.testnet.json).
Set `MONAD_TESTNET_PERP_FACTORY_ADDRESS` to its factory address in ignored
`backend/.env.local`. The local Perp gate
`MONAD_TESTNET_PERP_AUTONOMY_ENABLED` is separate and defaults to `false`.
Action, broadcast, and operator-trade gates must also be on for a funded
acceptance run. Manual Guard, Lite Mode, and live agent execution stay on/off
respectively as configured by the workspace. Restart the scoped stack after
changing local gates.

The operator must deposit Circle testnet USDC reserve before an entry:

```powershell
cd backend
node --env-file=.env.local --import tsx scripts/perp-factory-control.ts status
node --env-file=.env.local --import tsx scripts/perp-factory-control.ts reserve deposit 1
node --env-file=.env.local --import tsx scripts/perp-factory-control.ts gate on
```

The factory gate is an onchain enrollment switch. Close it after acceptance
with the same CLI's `gate off` command and return the local test gates to
`false` after active runs have settled. Never check `.env.local`, operator
keys, or wallet secrets into Git.

For the insufficient-reserve check, the operator can temporarily withdraw
**only uncommitted** USDC with `reserve withdraw <usdc>`, attempt an entry, and
then restore the reserve with `reserve deposit <usdc>`. A blocked entry has no
order hash and no fill. Do not withdraw while another run needs its committed
reserve.

## Scripted acceptance

The local operator console at `http://127.0.0.1:3104` has a **Mock perp
scenarios** panel. It accepts a run ID, a unique idempotency key, and a JSON
array of steps. Examples:

```json
[
  {"action":"market_entry","params":{"marketIndex":0,"isLong":true,"leverage":2,"marginUsdcUnits":"20000"}},
  {"action":"hold","params":{}},
  {"action":"close_position","params":{}}
]
```

Available steps include `price_move`, `market_entry`, `limit_entry`,
`fill_limit`, `amend_limit`, `cancel_limit`, `increase_size`, `reduce_size`,
`add_margin`, `remove_margin`, `set_triggers`, `execute_trigger`,
`accrue_funding`, `liquidate`, `close_position`, `hold`, `wait_expiry`, and
`wait_stop`. Price moves are funded swaps in the existing pools, and order
fills use the finalized onchain prices. A rejected step is recorded as
blocked, with no claimed fill. If a broadcast response is uncertain, inspect
the persisted hash and receipt before making another request. Reusing the
same scenario idempotency key cannot create a second script.

The default decision provider samples finalized executable pool prices every
15 seconds. It chooses the strongest 3% one-minute rise for a 2× long, or
the strongest 3% fall for a 2× short. It sets a 2% favorable take-profit and
1% adverse stop-loss, and exits a flat one-minute window. Operator scripts
exercise other policy-valid order types through the same executor and vault.
The `PerpVenueAdapter` boundary separates the mock venue's order admission,
receipt, fill, and position state so a future Perpl adapter can reconcile
Perpl's account-specific request IDs and fills without changing custody or
the mobile policy flow.
Perpl's [developer overview](https://github.com/PerplFoundation/perpl-docs/blob/main/docs/resources/for-developers/overview.md)
currently documents aUSD collateral, a separate onchain exchange account,
and different Testnet markets. Its [WebSocket order protocol](https://github.com/PerplFoundation/api-docs/blob/main/websocket.md)
and [integration guide](https://github.com/PerplFoundation/api-docs/blob/main/integrations.md)
are references for that later adapter; none of those accounts or endpoints
are used here.

Actual Testnet measurements and any blocked checks belong in
[PERP_AUTONOMY_ACCEPTANCE.md](PERP_AUTONOMY_ACCEPTANCE.md).
