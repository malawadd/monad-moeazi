# Stage 7 mobile preparation

This is an additive product-truth change under [Stage 7](stages-07-08.md),
not Q11 qualification. Mobile enrollment, native trading, release authority,
position-aware upgrades, and the complete stop/withdraw journey remain gated
by Q1–Q10 and the Stage 7 acceptance tests.

The authenticated Agent screen now loads the existing backend autopilot-limits
response when focused. It displays
the returned policy markets and configured cadence, and uses unavailable or
unknown values while the request is pending or fails. It no longer asserts
fixed BTC/ETH coverage or an exact next check time for an authenticated
account. A blocked account is shown as not active, while preview mode keeps
its existing illustrative content.

The backend currently returns `assignmentReady: false` and blocks managed
program start. This UI change neither enables trading nor certifies the
returned policy or schedule as an active release. Mobile `npm run typecheck`
and `git diff --check` passed. No cloud deployment, paid action, or trade was
made.
