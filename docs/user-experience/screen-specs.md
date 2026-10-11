# User Mode screen specifications

This is a design handoff for the clickable prototype and later product work. It
does not describe shipped behavior. The prototype must use simulated data and
must identify itself as simulated. Source-backed current route dispositions are
in [route-audit.md](route-audit.md); decision evidence is in
[research-notes.md](research-notes.md).

## Navigation and information architecture

Proposed User Mode has four tabs: **Home, Markets, Strategies, Activity**. A
visible account/settings button opens Account. Developer Mode restores the
current five tabs and diagnostic routes. The prototype includes a reviewer
state selector separate from the simulated customer UI.

Use existing visual tokens: paper/cream background, strong ink borders, solid
offset shadows, yellow/pink/sky/mint accents, Syne headings, Plus Jakarta Sans
body and the existing 120/180/220 ms motion values. Keep actions at least 48 dp,
work at large text sizes, announce state changes accessibly, and respect
reduced motion. Never rely on color alone.

## Home and first session

1. Lead with the **test AUSD balance**, labeled Monad Testnet. Keep test MON
   visible as network fuel. Do not convert balances to real dollars or invent a
   portfolio total.
2. Separate **available in wallet**, **allocated to strategy**, and **trading
   result**. Use verified current data; missing values are “Not available” or
   “Not yet returned,” never a fabricated zero.
3. Show one next-step card based on known account/funding/run state. Prefer a
   resumable checklist: get test MON → get test AUSD → review a strategy.
4. Skip steps already verified. A faucet page opening or copied address is not
   proof that funds arrived. On return, check the wallet service and report a
   pending state if the balance is not yet updated.
5. Keep recent activity short; open Activity for the full ledger.

States to prototype: signed-in empty, funded, active strategy, completed run,
stale balance, no network, and unavailable readiness data. For stale data, say
when it was checked and keep the last known amount clearly marked.

## Funding: MON and test AUSD

**Get test MON:** explain it pays Monad Testnet network fees. Copy-address
feedback, open the external faucet, return to Moeazi, check the current wallet
balance. Selecting a faucet link never marks funding complete. The current app
also lists Circle USDC faucet support; keep this outside the beginner AUSD path
unless a strategy needs it.

**Get test AUSD:** use the existing Agora faucet preparation, Mera signature,
OperationReview validation and verified transfer receipt. Before signing, show
that the faucet determines the claim amount, destination wallet, testnet, and the
maximum network fee in MON. The `requestFunds(address)` request contains no
amount input; show the exact credited amount only after a verified receipt.
After signing, distinguish submitted/pending from confirmed. If the operation
is uncertain, reconcile its existing operation ID before preparing another
claim. The local AUSD faucet guide documents verified transfer-log behavior.

Recovery copy needs a next action for an unavailable faucet, insufficient MON,
rejected passkey, uncertain submission, failed receipt and stale balance. Do not
imply funds arrived until the service confirms a receipt or balance update.

## Strategies and autonomous trading

Perpl deterministic is the initial candidate only when the server reports it is
available. Show what it does in one sentence, required AUSD, duration, venue and
fee summary, relevant risk, and where to see the run. Planned/unavailable
strategies are visibly non-actionable.

The current direct deterministic optimizer uses **fixed 100 AUSD funding** and
accepts a service-bounded duration from 10 to 720 minutes (current default 120).
Other Perpl setup paths take the live venue’s minimum/maximum funding and
duration from prepared service context. Do not pretend the direct optimizer
amount is user-configurable or invent venue bounds.

Before signing, summarize:

- 100 test AUSD from the Mera wallet to the displayed Perpl strategy vault;
- duration and the exact current mandate scope;
- trading fees/funding charges and the source of network gas;
- operator trading permission and that withdrawals are disabled;
- material risks, including loss, leverage, fees and price movement;
- owner stop and recovery expectations without promising immediate closure.

The current optimizer configuration uses maximum leverage 4×, maximum notional
30 AUSD, maximum margin 25 AUSD, and planned loss 0.15 AUSD. That planned-loss
value is a strategy target, **not a guaranteed maximum-loss cap**. Do not
describe the experiment as safe or imply returns. Values are sourced from
`backend/api-server/src/monad/perplOptimizerConfig.ts`; the prepared review is
the authoritative source of current limits and should remain accessible.

For an active run, show allocated AUSD, available collateral/equity if returned,
realized and unrealized result separately, current state/action, last update,
and recent events. `availableUnits`, `equityUnits`, realized/unrealized PnL and
`returnedUnits` can be absent; absence must not become zero. Stop is a signed
request. Display stopping, order/position reconciliation, settlement, and
returned funds as distinct states. Acknowledgement/submission is not a fill.
Owner recovery remains a separate reviewed/signed action and is only available
after settlement with no open position or live order. Eligibility is checked by
`src/screens/PerplRecoveryPanel.tsx`; do not imply ordinary stop instantly
returns AUSD.

Prototype unavailable, stale, active, stopping, uncertain, settled, incomplete
settlement and recovery states. Never invent pause behavior.

## Markets and manual trades

Keep **Markets** easy to find from Home and the bottom bar. Lead with market
name, readable price, a compact chart, watchlist and availability. Contract and
pool identifiers, hook/route capabilities, book freshness and execution
metadata belong in expanded details.

In detail, label a Spot action **Buy/Sell token** and a Perpl action **Open/close
position**. For Perpl, show long/short direction, leverage, collateral, order
size, estimated fees, quote freshness and liquidation risk before review.
Distinguish manual Perpl account funds and positions from autonomous AUSD
allocation. Current Spot/Perpl review, quote and validation layers remain in
charge of the exact transaction. A mode preference does not skip them.

## Activity, account and supporting routes

Activity rows use a plain event name, amount/asset and stable state. Use distinct
copy for requested, submitted, confirmed/finalized, filled, failed, reverted,
uncertain and settled. Expand to hashes/receipts and raw status when requested.
Offer safe status reconciliation before a duplicate retry.

Account contains passkey/account context, notifications, chart preferences,
sign-out, and a **Developer Mode** preference. Send, Wrap, managed vault, token
approval and recovery remain accessible through clear wallet tools or advanced
surfaces. Do not merge the existing ManagedVault mandate with Perpl autonomy.

Changing presentation is not signing out. Do not switch while a passkey signing
session is active. If an operation was already submitted, preserve its operation
ID and reconciliation path after a shell switch.

## Prototype states and limitations

Use explicitly fictional test balances and deterministic local outcomes. Labels
and reviewer state controls must make the simulation obvious. No live market
quotes, API responses, passkeys, faucet calls, trading permissions, token
transfers or transaction signing should occur from the prototype.
