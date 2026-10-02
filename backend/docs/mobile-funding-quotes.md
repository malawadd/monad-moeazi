# Modular funding estimates

`POST /api/mobile/funding/quotes` accepts `{provider, fiatCurrency, amount}` through
the bearer-authenticated proxy. Amount is the intended **total** fiat budget.
Results are indicative card estimates, not guaranteed prices, payment consent, or
evidence of wallet funds. The provider confirms the final amount in hosted checkout.

## Enablement and replacement

`MOBILE_FUNDING_QUOTES_ENABLED=false` is the default. Provider quote calls may be
metered; their cost is unknown. Obtain specific approval before enabling or testing
them. No new provider calls or payments are part of automated verification.

Quote-capable registrations are `moonpay@2`, `transak@2` (sandbox), `transak@3`
(production), and `banxa@2`. Select an
explicit version in `MOBILE_FUNDING_PROVIDERS`; merely enabling quotes does not
upgrade an existing `@1` selection. Keep version 1 credentials/registrations for
outstanding purchases. Existing idempotency keys recover their original operation
before quote-reference validation. Pending purchases do not depend on Redis quotes.

Add another adapter by implementing `quoteCapabilities`, `getQuote`, and its
provider-owned checkout parameter mapping, then registering its factory and config.
No screens, Convex schemas, or Temporal workflows require provider-specific changes.
An older adapter without quote methods remains usable with a checkout-only notice.

## Truth and request control

- Quotes normalize decimal strings, total fiat payment, net Arbitrum USDC, fees,
  card assumption, environment, and observation/freshness times. Missing fees are
  unknown, not zero. Moeazi adds no commission.
- MoonPay requests `areFeesIncluded=true` and `extraFeePercentage=0`. Its returned
  base amount—not an Android-supplied value—prefills checkout. Minimum clamping is
  reported instead of presenting a larger purchase against the original budget.
- Transak uses its public lookup quote API with trusted visitor IP and locks USDC
  on Arbitrum. Banxa uses Hosted Checkout v2, not its separate Native API product.
- Banxa display pricing has no fixed validity guarantee and is never cached/reused.
  Its connector requests fresh pricing before order creation. Other adapters may
  permit at most 30 seconds of result reuse. A UI expiry is a freshness cutoff,
  not a provider rate lock.
- Redis stores opaque 30-second references bound to owner hash, adapter version,
  environment, amount, currency, card assumption, and visitor-IP hash. References
  contain only normalized pricing/prefill fields, not credentials or raw responses.
- Identical in-flight requests coalesce; Redis coordinates cross-process leases
  and a twelve-provider-call/minute limit per owner/provider. Cache hits do not
  consume the limit. No automatic provider failover or retries occur.
- Quotes create no purchase, balance update, Activity entry, or durable workflow.
  Redis failure makes estimates unavailable while checkout-only access remains.

The mobile screen debounces by 750ms, cancels outdated requests, stops while hidden
or backgrounded, and provides an explicit Retry. Fixtures are labelled and never
used for authenticated users. Fee detail stays collapsed; no native dependencies
were added. Use Fast Refresh, not an Android rebuild.

## Verification

Run sidecar TypeScript and `npm run test:mobile`; mobile TypeScript, lint, and Jest;
and root TypeScript. Fixtures cover all three providers and fake replacements,
budget/precision/asset checks, caching, rate limits, expiry, owner/pin/IP binding,
purchase idempotency, debounce, cancellation, account switching and offline recovery.
Native TalkBack and compact/large-font visual checks remain manual checkpoints.

Provider references: [MoonPay buy quote](https://moonpay.readme.io/reference/getbuyquote),
[Transak lookup quote](https://docs.transak.com/api/whitelabel/lookup/get-quote), and
[Banxa Hosted Checkout quote](https://docs.banxa.com/products/hosted-checkout/docs/api-integration/get-a-quote).
