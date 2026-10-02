# Stage 6 native execution progress

This records bounded qualification work under [Stage 6](stages-05-06.md).
**Q10 has not passed.** No native submission, funded venue action, live
certificate, or customer activation is authorized by this checkpoint.

## Read-only Hyperliquid account snapshot

The existing gateway adapter now requests `spotClearinghouseState`, default-dex
`clearinghouseState`, and default-dex `openOrders` sequentially for the exact
validated 0x account address. It preserves the old `positions` response field,
adds raw source payloads and local request/receipt times, and labels the result
partial, non-atomic, and uncertified. Invalid response shapes or failed HTTP
requests fail the call; they are not interpreted as a zero balance or flat
position. Private place, cancel, and close operations remain gated.

The [official Info documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
requires the actual master or subaccount address, rather than an agent wallet.
Its [spot](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot)
and [perpetual](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals)
sections document the account response shapes. The three reads consume about
24 IP weight per account snapshot under the documented
[rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits).
This is an on-demand read, not a 10–100-account polling design.

## Boundaries before live use

- The snapshot covers the default perpetual dex and first spot dex only. It
  does not discover other account addresses or HIP-3 dexes.
- Open orders alone cannot establish fills, final order status, funding,
  transfers, collateral movement, or complete account history.
- Three public reads are not atomic. Their local timestamps do not establish
  exchange event ordering or settlement finality.
- The execution workflow still passes an internal `proposal.account_id` to
  reconciliation. Its former false `executed` transition has been removed,
  but an explicit venue-address mapping and fill-confirmed transition are
  required before this path may report a live result.
- Existing `venueAccounts` rows distinguish Hyperliquid master and agent-wallet
  roles in older code, while the newer setup writer stores an agent-wallet role
  and an unconstrained `accountId`. Neither `accountId`, `walletAddress`, nor
  `ownerAddress` is currently proven to be the actual master/subaccount address
  required by the Info API. A later owned linkage must carry that exact address
  and its native verification evidence; the workflow must not infer it from an
  internal strategy ID or an agent wallet.
- Portfolio-margin borrowing may produce a negative spot total; the current
  parser rejects that state. Portfolio-margin accounts are not qualified by
  this partial reader.
- The gateway's authenticated safety-decision route remains in place, but
  authentication and successful HTTP reads are not a Q10 certificate.

## Next main-path qualification

1. Define exact owner account versus agent wallet identity, order/client ID,
   durable venue observation, and reconciliation state contracts. Keep partial
   reads distinct from authoritative reconciled state.
2. Implement and qualify order/fill/status recovery, native authority,
   protective close/cancel, collateral, and withdrawal per operation. Proceed
   to a funded qualification only with the separate approval and envelope
   required by [Q10](validation-and-gates.md).

Independent Luna XHigh review accepted only the isolated read path. Its focused
mocked suite passed 3/3. The reviewer traced the internal strategy account ID
through `analysis_completion.py` and `execution_workflow.py`; it is not a
venue address, so the existing integrated execution path cannot use this reader
as-is. The review also confirmed that the workflow's unconditional `executed`
transition would overstate pending or uncertain submissions. These are release
gates, not evidence of native execution.

The Python gateway image was rebuilt locally and its container recreated.
`/health` returned `ok`; Hyperliquid reported public reads healthy with
`live_submission_enabled: false` and its signing certification gate closed.
The health handler made one public `meta` Info request. No account data,
private operation, funded trade, or venue reconciliation request was sent.
The root web `/agents` route also returned HTTP 200 after its local dev server
restart; that is not the signed-in console journey.

## Proposal outcome correction

The older execution workflow could mark a proposal `executed` even when the
gateway explicitly returned `simulated`, or when a native submission received
only a partial account read. A bounded local correction now maps the former to
the existing `simulated` proposal status and leaves submitted, executed,
uncertain, or pending native responses `executing` until fill-confirmed
reconciliation exists. The portal activity badge treats `executing` as in
progress. Independent Luna XHigh review accepted this truthful-status
checkpoint: focused workflow tests passed 5/5, proposal authorization tests
5/5, and TypeScript typecheck passed. The test uses the adapter-shaped nested
partial snapshot. The account-address mapping and durable native recovery
gates remain open. In particular, an already-`executing` proposal can enter
dispatch again after a Temporal workflow closes; a stable idempotency key alone
does not prove venue-level deduplication.

Root repeated local verification after the portal change: Python 3.12 focused
workflow/controller/reader suites passed 11/11, `npx tsc --noEmit` passed, and
`git diff --check` found no whitespace errors. The Python worker image rebuilt
locally; no worker was started and no Convex contract was deployed.

## Closed-workflow repeat-dispatch guard

Normal customer dispatch and the Temporal activity now require proposal status
exactly `approved`. An already-`executing` proposal is rejected before a gateway
call, including when a delayed Temporal start arrives after the previous
workflow closed. Independent Luna XHigh review accepted this bounded guard:
Python workflow tests passed 6/6, customer-action tests 2/2, and TypeScript
typecheck passed. It retains the stable idempotency key and does not add native
authority. An uncertain order now needs an explicit reconciliation-only
recovery process; this guard does not resolve or safely retry that order.

[Hyperliquid's order API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint)
supports a 128-bit client order ID, while its
[Info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
can query order status by order ID or client ID. These are inputs to a future
durable intent and recovery protocol, not proof that repeating an order with
the same client ID is safe. The actual account address, signed action, nonce,
submission uncertainty, fills, and financial reservation must be bound before
native dispatch is qualified.

The local worker image was rebuilt after this guard. The worker remained
stopped; no Convex deployment or native account call was made for this change.

## Missing owned-address fail-closed checkpoint

The current Convex execution context has no authoritative Hyperliquid master or
subaccount address receipt. Legacy master rows, owner-wallet fields, and newer
agent-wallet setup rows cannot establish that identity. The workflow now refuses
native-capable Hyperliquid dispatch before `/internal/dispatch` when the verified
binding is absent. It records `blocked` with `not_submitted`, rather than leaving
an unsubmitted order `executing`. If a gateway returns a native-looking outcome
while the gate is closed, reconciliation skips both preflight and read instead of
sending the internal strategy account ID to the venue. The simulated path remains
usable. Independent Luna XHigh review accepted this bounded slice; its focused
workflow suite passed 7/7. No private venue operation or account read was sent.
Root's focused workflow and read-only adapter regression passed 10/10, and the
normal Python worker image was rebuilt locally without starting that worker.

This is a safety boundary, not native-address resolution. The pre-dispatch check
assumes the worker and gateway share the Compose live/certified settings; the
gateway must independently require a verified binding before Q10. A future
Convex-owned receipt must prove the actual trading address, bind it to the
strategy account and setup authority, and expose it through the execution
context. Fill-confirmed order status and durable recovery remain open.

## Verified address projection checkpoint

The gateway's existing Hyperliquid Info binding receipt is now consumed by
the customer-team execution-context query only when the linked agent-wallet
venue account, integration, permission, and encrypted credential are uniquely
active and current. The worker receives the exact master/target address and
validates its strategy-account binding and expiry; credential ciphertext is
never returned in the worker context. This supersedes the missing-address part of
the earlier checkpoint for accounts with a qualified binding. It does not
establish a native order: the worker blocks before dispatch until the durable
financial order package is implemented. Focused TypeScript, Convex and Python
checks passed and the rebuilt local gateway/worker returned health 200. No
funded Hyperliquid operation or fill confirmation was observed.
