# Security and acceptance checklist

## Identity

- Verify on physical Android hardware that the same Magic login returns the same lowercase owner address used by web.
- Confirm both clients resolve the same Universal Account, strategy, credits, balances, and history.
- Test refresh rotation, replay rejection, per-device logout, and independent sessions on a second device.

## Signing

- Test personal signing, typed data, root-hash signing, and Magic EIP-7702 support on Android before enabling Universal Account submission.
- Treat a signed EIP-7702 authorization as actionable, not as a harmless capability probe. Real 7702 tests require separate funded-test approval.
- Signing-proof challenges are owner-, chain-, purpose-, expiry-, and one-time-use bound; raw signatures are not persisted.
- Reject any altered owner, amount, recipient, chain, intent, quote, policy, operation ID, expiry, or signature request.
- Preserve idempotency through retries and uncertain submission results.
- Keep simulation, preparation, broadcast, confirmation, and reconciliation visibly distinct.

## Beginner experience

- Test compact and large phones, 200% font size, TalkBack, reduced motion, keyboard avoidance, offline resume, interrupted deposits, backgrounded signing, stale responses, long IDs, and authenticated deep links.
- Verify the typography-only tab bar grows without clipping at large font scales and all targets remain at least 48dp.
- Verify visible Back, modal Close, hardware Back, and predictive Back resolve to the same safe destination.
- Verify haptics respect device settings and remain supplemental to visible confirmation and error copy.
- A new user should reach Start AI trader without model, venue, routing, or blockchain configuration.
- A running user should identify total balance and Stop immediately.
- Verify Funding says USDC and Arbitrum before exposing the copy action, shows ETH only as network-fee money, and keeps ETH-only accounts in `needs_funds`.
- Verify cached-first loading, pull-to-refresh, foreground refresh, the bounded 15-second polling window, stale fallback, and recovery after an interrupted transfer.
- Verify no main-page or Technical Details path reveals or copies the deposit address before the device-local guide acknowledgement is persisted.
- Verify the slide confirmation requires 85% travel, resets after an incomplete or interrupted gesture, works through TalkBack activation, and fails closed when AsyncStorage cannot save.

Use fixtures and recorded responses by default. Do not run funded transactions, paid provider probes, Play Console actions, or cloud push tests without separate approval.
