# Prioritized implementation handoff

The current task produces research and a clickable prototype only. No production
screen, backend API, trading gate or funded operation is changed here.

## P0 · Presentation-mode foundation

**Scope:** add a persistent, Monad-namespaced `presentationMode` preference,
defaulting to `user`; keep it separate from `AppContext.mode` (loading or
authenticated). Suggested local key: `moeazi.monad.mobile.presentation-mode.v1`.

**Acceptance criteria:**

- A fresh install opens User Mode; the setting survives app restart.
- Settings has an accessible Developer Mode control and explains that it changes
  screen presentation only.
- Developer Mode restores the current five-tab layout and registered diagnostic
  pages. User Mode uses Home, Markets, Strategies and Activity with Account in
  settings.
- Both shells share owner identity, service clients, balances, activity,
  prepared-operation validation and consent requirements.
- The preference is not sent to APIs and never changes an auth/session state,
  wallet ownership, authorization, server gate, mandate, or active run.
- Do not switch while a passkey signing session is open. A submitted operation
  retains its identifier and can be reconciled after switching.
- Unit-level navigation checks cover fresh preference, persistence, signed-out
  state, active signing, submitted/uncertain operation and mode restoration.

**Backend dependency:** none for the preference. Keep it local and presentation-only.

## P1 · Home and testnet funding

Replace the current balance list/action stack with a balance-led Home and
resumable funding readiness. Reuse wallet queries, existing MON faucet link,
Agora AUSD preparation, operation validation, Mera signing and receipt checks.

**Acceptance criteria:**

- Every amount says Test/Monad Testnet; MON fee funds and AUSD trading funds are
  visibly distinct.
- Balance, observed freshness and errors do not become false zeros or success.
- Opening an external faucet does not complete a funding step; return checks the
  wallet again.
- AUSD claim review explains that the faucet determines the amount, plus
  destination/network/maximum fee before the existing validation/signature path;
  show exact credited amount only after a verified receipt because
  `requestFunds(address)` has no amount input.
- Duplicate claim preparation is prevented/reconciled for uncertain submission.
- Home shows one next action from verified state and handles empty, funded,
  stale, disconnected and unavailable state.

**Data dependency:** there is no observed unified “beginner readiness” response.
Compose next-step visibility from current wallet/faucet/run services with
explicit unknown states; do not infer a completed external MON faucet transfer.

## P2 · Strategy choice and Perpl autonomy

Make the available strategy understandable and connect to existing Perpl setup,
validation, status, stop, history and recovery screens.

**Acceptance criteria:**

- Strategy availability/limits come from the current catalog/venue response.
- Perpl direct deterministic amount is fixed at 100 AUSD; duration bounds come
  from service terms (current UI: 10–720 minutes, default 120).
- Exact amount, duration, fee, operator scope, risk and available exit/recovery
  are reviewable before the same existing validation and signature flow.
- Active, stopping, uncertain, settled, incomplete-settlement and recovery states
  are distinct. No instant pause/return is promised.
- Missing run units remain missing/unknown, not `0`; submitted/accepted orders
  are not reported as fills.
- Stop/recovery keeps the existing owner checks and transaction review.

**Data dependency:** `PerplRun` values for available, equity, realized/unrealized
PnL and returned amounts are optional. Recovery is not available until settled
and without open positions/live orders. Current optimizer configuration uses
4× maximum leverage, 30 AUSD max notional, 25 AUSD max margin and a 0.15 AUSD
planned-loss target; that is not a guaranteed loss cap. See
`backend/api-server/src/monad/perplOptimizerConfig.ts` and
`src/screens/PerplRecoveryPanel.tsx`.

## P3 · Markets and manual Spot/Perpl

Unify market discovery and preserve manual Spot and manual Perpl access through
Markets. Keep the wallet-swap and direct Perpl validation/review services intact.

**Acceptance criteria:**

- Search/watchlist and readable market name/price/status lead the page.
- Raw pool IDs and operational venue details appear only when requested.
- Spot token purchase is clearly different from leveraged Perpl position entry.
- Perpl review includes leverage, collateral, fee, quote freshness, and material
  liquidation risk. Spot review keeps the minimum-received, fee, expiry and
  unverified-pool warning.
- Mode change cannot bypass a server quote, transaction validation, fresh user
  consent or uncertain-operation reconciliation.

## P4 · Activity, settings and route cleanup

Simplify Activity rows and detail, design settings/recovery and decide every
unregistered file/deep-link mismatch listed in [route audit](route-audit.md).

**Acceptance criteria:** human-readable events distinguish requested, submitted,
confirmed/finalized, filled, failed/reverted and settlement; receipts stay
expandable. Every accepted push/deep link resolves to an authorized, mode-aware
destination or a safe recovery screen. Stale `Safety`, `Credits`, purchase-status
and `Withdraw` config cannot open an unregistered diagnostic destination.

## Shared technical rules

- No new production API is required by the prototype.
- If a later screen needs aggregate, available or readiness data missing from
  existing services, document that exact gap and use an unavailable state until
  a separately reviewed service contract exists.
- Auth/session `mode` and UI `presentationMode` are different fields.
- Mode selection cannot enable gates, authorize transactions, stop a run, change
  wallet identity, or change account state.
- Keep testnet identity and the current service-derived fees/status visible.
- Perform later implementation with GPT-6 Luna at its highest supported
  reasoning effort (`max`); the supervising agent verifies service connections
  and the relevant checks.
- Implement after the research prototype is reviewed. Current product and local
  testnet gates remain governed by `LOCAL_STACK.md`.
