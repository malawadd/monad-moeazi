# Moeazi Monad mobile architecture

This repository is an independent React Native app and local backend. It does not
import or symlink source from the Arbitrum repositories. The current release is
limited to Mera passkey authentication and a signed-in account screen.

## Authentication

- Mera creates or retrieves a passkey bound to `moeazi-monad.kiyan.finance`.
- The WebAuthn PRF output derives an EVM key at `m/44'/60'/0'/0/0`, following the
  Mera mobile demo. The key signs one short-lived backend challenge and is then
  cleared; the PRF output is never stored.
- The backend verifies the address signature, consumes each challenge once, and
  issues per-device access and refresh credentials. Refresh rotation and logout
  use Monad-namespaced secure storage on the phone.
- The server records a Mera identity as `mera:<lowercase-address>`. A Mera
  session creates only the account identity; it does not create a wallet,
  strategy, or chain state.
- `MERA_RP_ID` must remain `moeazi-monad.kiyan.finance`. This stable host serves
  Android Digital Asset Links and the iOS Apple App Site Association file.

See [`LOCAL_STACK.md`](../LOCAL_STACK.md) for tunnel and association setup.

## Current product scope

After sign-in, the app shows the Mera-derived address and a sign-out action.
Funding, trading, wallet activation, push registration, and old Magic or
Arbitrum mobile endpoints are paused until the separate Monad execution
migration. The old wallet adapter and product screens remain in the source tree
for migration work, but are not initialized or reachable from the current app.

## Local configuration

The active native setting is `API_BASE_URL`. On the Android emulator the
default is `http://10.0.2.2:3102`; physical devices need an HTTPS API address.
Local API and Convex state use this repository's isolated `moeazi-monad`
Compose project and persistent Convex deployment. No Magic publishable key is
needed for mobile sign-in.

The account screen displays the wallet address returned by the authenticated
Mera session. The app does not infer account state, trading limits, or readiness
from a chain.
