# Mobile Autopilot and local operator controls

Use this page for the isolated Moeazi Monad mobile copy. The Android client is at
this repository's parent; its [`README.md`](../../../README.md) and
[`Android build guide`](../../../docs/ANDROID_BUILDS.md) own APK building and
installation. This guide describes its matching backend and local console.
The [master architecture](../research/master-plan/README.md) remains the design
reference, while source and observed receipts determine current availability.

## Account journey and state owners

1. Magic signs the customer in. The verified Magic owner address identifies the
   customer wallet; Particle Universal Account tooling may prepare and relay a
   transaction for that same address. It does not become a second customer wallet.
2. The phone shows the wallet's Arbitrum USDC and ETH. A managed program version,
   explicit owned assignment, capital amount, period, and risk policy form the
   proposed mandate. Requesting a mandate does not itself move funds.
3. Backend preparation binds the exact owner, program, vault, amount, and
   operation. The phone reviews and requests Magic signing. Only a finalized
   deposit and authoritative vault/account read can establish committed capital.
4. Temporal schedules analysis; Python workers use the selected Moeazi-owned
   model routes and sanitized evidence. Validated output can create a proposal or
   abstain. An LLM never holds wallet keys or submits an order. Deterministic
   finance/risk and the isolated execution boundary govern any attempted order.
5. Mobile Activity and Home display current Convex projections. Detailed model
   calls, evidence, and execution history belong in Timescale. An order request
   is not a fill; finalized venue and account observations must reconcile before
   the product reports a position or result.
6. Stop blocks new entries. Closing exposure, returning vault funds to Magic,
   and external withdrawal are separate, observed steps. A stopped assignment
   alone does not establish a flat position or a completed withdrawal.

The mobile API contract is in `app/api/mobile/`; current product records and
credit balances are in Convex. The phone's endpoint map is
`../../../src/services/apiClient.ts`; venue custody and qualification
limits are in [wallets and execution](wallets-and-execution.md). Treat a UI
state, submitted operation, fixture test, and finalized on-chain receipt as
different evidence levels.

## Lightweight console versus customer controls

Start the product backend first, sign in at `http://127.0.0.1:3102`, then use
the operator console at `http://127.0.0.1:3104`.
The console is loopback-only and proxies an allowlisted set of authenticated
operator operations; it has no trading engine or separate database. See its
[`README.md`](../../operator-console-lite/README.md) for the exact controls.

- **Moeazi-owned provider keys:** OpenAI, DeepSeek, and OpenRouter keys entered
  here go into ignored `.env.agents.monad` and reload the analysis runtime. Customer
  web BYOK is separate. Key presence does not prove model access or a paid call.
- **Mobile model release:** the operator freezes and releases a model-route
  candidate for *new* analysis jobs. Existing jobs keep their recorded route;
  model routing does not redeploy the vault or silently rewrite a signed mandate.
  Enrollment program-version selection is a separate setting.
- **Lite Mode:** a Redis-backed development cap on analysis work. It is neither
  the customer Autopilot mode nor the live execution switch. Turning it off can
  increase provider cost.
- **Test app credits:** search by case-insensitive email, exact Magic wallet, or
  Convex user ID. The console lists every matching account and its current
  total/reserved/available ledger balance. Select the *wallet-bearing account*
  used in mobile before granting credits. Duplicate email records are distinct
  users; a zero balance on one does not contradict another account's balance.
  Grants are idempotent Convex ledger entries, not USDC or provider balances.
- **Pause app-credit charging:** new test analyses still require available app
  credits but release their reservation on completion. Already-started work
  keeps its original charging setting. Model-provider charges can still occur.

## Verification boundary

For mobile changes, verify installation on the intended CPU/Android version,
backend reachability, Magic sign-in, the exact Magic owner and credit account,
and an authenticated Home/Activity read before diagnosing trading behavior.
For provider or execution work, use the matching agent/venue evidence and
failure receipts; do not turn a UI test into an unplanned funded or paid probe.
Current certification gates remain in [known gaps](known-gaps.md).
