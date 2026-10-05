# Mera mobile authentication acceptance

## Passkeys and sessions

- On a PRF-capable Android authenticator, create a passkey and verify that its
  derived address signs in successfully. Sign out, sign in with the same
  passkey, relaunch, and restore the server session.
- Confirm the app derives the same address on each ceremony and displays the
  address returned by the signed Mera session.
- Verify the PRF output, mnemonic seed, and private key are not written to
  storage or sent to the backend, and that signing material is cleared when the
  ceremony finishes or fails.
- Reject malformed and invalid address signatures, expired challenges, replayed
  challenges, expired refresh credentials, refresh tokens with non-Mera
  providers or mismatched subjects, and old Magic access or refresh tokens.
- Verify refresh rotation and device logout; if the API is offline during
  logout, the app still clears its local session.
- Confirm sign-in creates only the Mera user identity. It must not create a
  Magic wallet, Arbitrum wallet, strategy account, or chain state.

## Associated domains and route boundary

- Confirm both `https://moeazi-monad.kiyan.finance/.well-known/` association
  URLs return directly over HTTPS without a redirect or Cloudflare Access gate.
- Confirm Android asset links include the debug certificate fingerprint and
  package `com.moeazi.monad.mobile`; add release fingerprints when available.
- Confirm iOS uses `webcredentials:moeazi-monad.kiyan.finance` and the response
  includes the configured Apple Team ID and bundle ID.
- Confirm Hono does not register old Magic/mobile chain routes and that the
  direct public Convex chain entrypoints reject Mera sessions.
- Confirm the local Magic cleanup reports first, makes no changes when there
  are no matching users, and aborts if a wallet or strategy is linked.

iOS device validation requires macOS, Xcode, and the Apple Team ID. Use fixtures
and local services by default. Do not run funded transactions, paid provider
probes, Play Console actions, or cloud push tests.
