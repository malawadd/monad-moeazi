# Local mobile integration configuration

Provider credentials stay in the ignored root `.env.agents`. Never copy them to
Android, `NEXT_PUBLIC_*`, Convex, or an analysis worker. Compose explicitly clears
financial-provider secrets in Python services inheriting the shared dev env file.
The internal `WORKER_SHARED_SECRET` remains in the existing root `.env`.

## Current development selection

- MoonPay is selected as `moonpay@2`, with matching sandbox keys and
  `MOBILE_FUNDING_QUOTES_ENABLED=true` after explicit sandbox-usage approval.
- The approved catalog checks confirmed `usdc_arbitrum` is enabled and maps to
  canonical USDC on chain 42161. Sandbox never credits the real wallet.
- The actual sandbox buy-quote request for `usdc_arbitrum` returned HTTP 400,
  `1_SYS_UNKNOWN`: "Currency not supported in test mode." Catalog availability
  does not establish test-mode quote support. The app now shows that restriction;
  no alternate token/network or production key is substituted automatically.
- Transak production catalog lists canonical Arbitrum One USDC (chain 42161,
  `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`). One approved production
  $50 card quote returned an indicative 46.58 USDC with a $3 provider fee.
  The first production hosted-session check returned HTTP 401, so checkout is
  not verified and `transak@3` remains unselected. The old sandbox keys and
  `transak@1`/`@2` stay separate, but their testnet USDC delivery is blocked;
  `@3` uses the production
  credentials in `TRANSAK_API_KEY_PR` and `TRANSAK_API_SECRET_PR`.
- Pimlico accepted the Arbitrum bundler key and EntryPoint v0.7. Policy-management
  lookup returned 401; this does not prove the policy is invalid or authorized.
- Gas budgets are zero; sponsorship and certification remain false. Observed
  contract bytecode hashes do not certify signing or enable mainnet spending.
- No purchase, sponsorship request, signature or transaction was performed.

## Tunnel and Android

`MOBILE_PUBLIC_RETURN_ORIGIN` is `https://mowazitest.kiyan.finance` (no path).
MoonPay's webhook setting must use:

```text
https://mowazitest.kiyan.finance/api/mobile/funding/webhooks/moonpay
```

If Transak production checkout becomes authorized and works, configure its
dashboard webhook to `https://mowazitest.kiyan.finance/api/mobile/funding/webhooks/transak`.
Do not select `transak@3` or claim end-to-end purchase settlement based on a
catalog or quote response alone. Transak requires partner backend IP allowlisting
for hosted-session creation.

Next's ignored `.env.development.local` selects `cf-connecting-ip` and the expected
tunnel hostname. Cloudflare must overwrite the visitor-IP header; direct origin
access must stay private. A hostname/Ray check is not proxy authentication. The
helper normalizes IPv6, unmapped IPv4, and Cloudflare pseudo-IPv4 fallback. It
rejects unverified local requests and Worker subrequests rather than signing a
checkout for the wrong visitor. No Cloudflare Enterprise feature is required.

Android's ignored `android/local.properties` uses the public tunnel API and the
same existing Magic publishable key. Changing those native build fields requires
one incremental Android build; subsequent TypeScript UI edits use Fast Refresh.

## Reloading safely

```powershell
powershell -File scripts/reload-mobile-integrations.ps1
# After sidecar source changes:
powershell -File scripts/reload-mobile-integrations.ps1 -Build
```

This reloads only the sidecar. It does not start AI workers, contact providers,
deploy Convex, or spend gas. Next usually reloads changed local env files itself.
The analysis workers remain stopped, so purchase reconciliation on their existing
queue is not running. Do not claim completed settlement from a checkout return;
starting metered reconciliation requires a separately bounded test approval.
