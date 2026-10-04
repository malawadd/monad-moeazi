# Modular funding and covered network fees

## Delivery and defaults

Android remains isolated in the React Native application. No existing web page was redesigned.
The mobile app has Add money, provider selection, purchase recovery, covered-fee
setup/review, sponsored withdrawal review, device security, and one common Android
Custom Tabs launcher. Direct-deposit disclosure/timeline remains intact. No purchase,
sponsorship, funded canary, cloud deployment or live execution was performed.

All real integrations default closed. The environment example is
`execution-sidecar/mobile-integrations.env.example`. A configured adapter is not a
certified integration. `MOBILE_SPONSORSHIP_CERTIFIED` must remain false until the
native/signature/provider/contract checkpoints below have passed with separate approval.

## Ownership and provider replacement

- Next routes authenticate bearer sessions and proxy only named connector commands.
  They do not own provider credentials. Trusted client IP must come from an ingress
  that overwrites the configured header, not untrusted `X-Forwarded-For`.
- `execution-sidecar/src/mobile/contracts.ts` separates OnRamp, Bundler, Paymaster,
  AccountExecution and the existing phone-only Wallet signer.
- `registry.ts` resolves explicit `id@version` pins. `configuration.ts` is the
  composition root: register a new adapter there, provide its configuration validation,
  display name and conformance tests. Catalog and screens are provider-neutral.
- Select funding `id@version` pins through `MOBILE_FUNDING_PROVIDERS` (bare IDs are
  accepted only while exactly one version is installed). Webhooks authenticate
  against retained versions and bind to the original operation pin. Select bundler and
  paymaster independently through `MOBILE_BUNDLER` and `MOBILE_PAYMASTER`.
- An operation retains its original pins. Disable an ID for new work but retain its
  registration/credentials until every outstanding operation settles. Never change an
  adapter's behavior under an existing version. No automatic provider failover exists.
- Switching infrastructure does not change the Magic owner or delegated contract.
  Unknown delegations are blocked, not migrated automatically.

Convex `mobileConnectorOperations` owns durable current records, nonce reservations,
idempotency, fee reservations, status transitions and sanitized Activity projections.
Temporal reconciles by operation ID only. Redis stores encrypted Transak token cache
and a single-writer refresh lease. Timescale migration
`053_mobile_connector_history.sql` owns sanitized detailed state history. No raw
webhook, checkout URL, wallet address, token or signature enters that history.

## Funding

Provider-backed card estimates use the shared quote contract and optional purchase
reference. See [funding estimates](mobile-funding-quotes.md) for v2 adapters, Redis
freshness/rate controls, and the separately approved, default-off quote rollout.

Routes: `GET /api/mobile/funding/options`, `POST /api/mobile/funding/purchases`,
`GET /api/mobile/funding/purchases` (pending), `GET .../purchases/:id`,
`POST .../webhooks/:providerId`.

Only provider, fiat currency, decimal amount and idempotency key come from the phone.
The worker derives the Magic wallet and locks canonical Arbitrum USDC delivery.
Each provider's configured USDC mapping must be verified against Circle's canonical
contract, not USDC.e. Missing/unverified mappings stay unavailable.

Transak uses its backend Widget URL API (single-use, five-minute links); MoonPay
signs the exact URL query and IP binding; Banxa obtains a quote then a buy order.
Each adapter verifies its own webhook format. Provider completion is only
`delivery_pending`; a successful canonical-USDC Transfer receipt to the authenticated
owner plus a subsequent block is required for `received`. Funding/Home are refreshed
independently. Purchase completion never starts AI or grants credits.

A checkout-creation timeout becomes needs-attention rather than another payment.
The same idempotency key is bound to the original provider/amount. Returning from a
browser or receiving `?paid=true` cannot complete a purchase. Return URLs are
allowlisted first-party HTTPS; the page carries only an opaque ID into Moeazi.
Checkout fees remain provider-disclosed; Moeazi's added commission is zero.

## Sponsored execution

Routes: `GET /api/mobile/gas/readiness`; version `v2` activation
`prepare`, `authorize`, `submit`, `:id`; version `v2` withdrawals `prepare`,
`submit`, `:id`.

Activation has two signature-only stages: review the exact EIP-7702 authorization,
verify with device security, sign locally, then review the final sponsored operation
and verify/sign its hash. `authorize` estimates with the signed authorization but
does not store it or broadcast. `submit` receives signatures in request memory only.
This replaces the earlier user-paid Type-4 path for new sponsored setup; legacy
direct-transaction records/reconciliation remain separate and recoverable.

Kernel is pinned to 0.3.3 at `0xd6cedde84be40893d153be9d467cd6ad37875b28` and
EntryPoint v0.7 at `0x0000000071727de22e5e9d8baf0edac6f37da032`. Their deployed
bytecode must match configured reviewed hashes. Kernel nonce-key encoding follows
the pinned SDK. The worker cannot sign for the owner or create a fallback key.
Activation enables wallet execution, not AI/session-key trading authority.

Preparation reserves a conservative fee ceiling and an owner-execution lock.
Current v1 global/account budgets are deliberately **lifetime ceilings**, not daily
limits. Reservations persist for uncertain/needs-attention operations. A confirmed
settlement replaces the reservation with the pinned paymaster's normalized actual
coverage cost, including its surcharge; core code has no provider-specific pricing.
Gas budgets do not cover unrelated subscription/API overages. Expired unsigned preparation
releases it. Budget and nonce checks are atomic Convex mutations. Budget aggregation
currently scans the small operation ledger; production scale needs indexed budget
projections before expanding rollout.

The phone verifies exact owner, chain, account, calldata, amount, recipient, expiry,
user-operation hash and review hash before opening Magic. Native confirmation uses
strong biometrics/device credentials on Android 11+. Unsupported devices fail closed.
Backgrounding invalidates an unsigned review. Recovery stores only owner-scoped
operation ID/kind, never signatures. Sending is claimed atomically before broadcast.
Timeout/unknown results are reconciled and never resent automatically.

Reconciliation requires the matching successful EntryPoint UserOperationEvent and
the attributable USDC Transfer segment for withdrawals. Outer transaction success,
another operation's transfer or a pre-validation log cannot count as completion.
Activation additionally checks the exact delegated implementation. New withdrawals
do not silently fall back to charging ETH. Legacy direct withdrawals remain readable.

## Local verification and outstanding release checkpoints

Local suites: sidecar adapter/core/receipt tests; mobile TypeScript, ESLint and Jest;
Convex/root static TypeScript; Python workflow tests; Android x86_64 debug build
and Android Metro bundle validation. A JavaScript UTF-8 polyfill loads before viem
for Hermes compatibility. Metro emitted a dependency export-fallback warning for
`@noble/hashes/crypto.js`, but bundle generation completed successfully.
Run sidecar conformance and safety fixtures with `npm run test:mobile`.
Use Fast Refresh for subsequent styling changes. The initial all-architecture Windows
build hit a CMake 260-character path limit; emulator-only x86_64 succeeded.

Not claimed by local fixtures: real hosted checkout/eligibility, public return links,
provider support responses, real sponsorship acceptance, native interruption/TalkBack
on a device, or contract/signature/gas certification. These remain required gates.
The approved local runtime smoke check deployed Convex, rebuilt the local API,
gateway and sidecar, and opened the x86_64 Android debug app to Welcome. Debug
builds now use the ADB Metro tunnel; the preview launcher reuses the installed app
unless `-Rebuild` is requested. Local service health and the disabled-provider
catalog passed. User-assisted login, browser-return and device-security checkpoints
remain separate; no purchase, sponsorship or funded transaction was performed.
Deploying Convex or metered infrastructure requires approval.

Before enabling a provider: confirm order/quote payload variants, forged/retried
webhooks and timestamp formats using provider-issued sandbox credentials; verify
asset mapping/return-domain/IP requirements and support cancellation/refunds.
Transak referrer-domain approval for Custom Tabs is a specific native checkpoint.
Paymaster policy must restrict owner allowlists, contract, selector, zero ETH value,
chain and per-operation cost. Configure lifetime limits and verified artifact hashes.
Keep live AI/venue certification closed. No swap, bridge, off-ramp or paymaster setup
has been performed.

## Official references

- [Transak Widget URL migration](https://docs.transak.com/guides/migration-to-api-based-transak-widget-url)
- [MoonPay URL signing](https://dev.moonpay.com/widget/on-ramp/customization/url-signing)
  and [IP matching](https://dev.moonpay.com/widget/on-ramp/customization/ip-matching)
- [Banxa buy-order API](https://docs.banxa.com/products/hosted-checkout/docs/api-integration/create-buy-order)
- [Pimlico EIP-7702](https://docs.pimlico.io/guides/eip7702/demo)
