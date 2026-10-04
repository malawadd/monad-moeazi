# Return-to plan: Google Play Billing for Moeazi credits

Billing is deliberately disabled. `UnconfiguredBillingAdapter` lists a versioned preview catalog and always returns `BILLING_NOT_CONFIGURED`; it never writes to the real credit ledger.

Before enabling purchases:

1. Complete the financial-features and digital-goods policy review in Play Console.
2. Create Play products and map every Play product ID to a server-owned catalog version.
3. Add a native `PlayBillingAdapter`; never trust app-provided price or credit quantity.
4. Send the purchase token and product ID to a disabled-by-default backend verification endpoint.
5. Verify the purchase token with Google Play on the server, bind it to the authenticated Moeazi user, and enforce idempotency.
6. Grant credits only after verified purchase state. Record the catalog version, Play order reference, acknowledgement state, and ledger entry.
7. Acknowledge or consume the purchase within Google’s required window after the durable credit grant.
8. Reconcile cancellations, refunds, revocations, pending purchases, account hold, and multi-device restore events.
9. Make restore read from verified server state. The phone must never turn a local receipt into credits by itself.
10. Add tests for replayed tokens, altered product IDs, cross-user tokens, refunds, interrupted acknowledgement, and uncertain network results.

References: [Google Play payments policy](https://support.google.com/googleplay/android-developer/answer/9858738) and [Play Billing backend guidance](https://developer.android.com/google/play/billing/backend).

Any Play Console action, live billing request, cloud verification, or paid-service test needs separate cost approval.
