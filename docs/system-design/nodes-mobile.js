window.SYSTEM_DESIGN.components.push(
  ...[
    {
      id: 'mobile-app',
      layer: 'mobile',
      name: 'Moeazi mobile app',
      kind: 'React Native · TypeScript',
      status: 'active',
      summary:
        'Native mobile UI with Home, Markets, Agent, Activity, and Account tabs plus operation and venue screens.',
      detail:
        'RootNavigator registers the five authenticated tabs and nested screens for funding, sends, operation review, managed vaults, Spot autonomy, mock Perp, and Perpl. Android/iOS identifiers and the deep-link scheme are Monad-specific.',
      tech: [
        'React Native 0.85',
        'React 19',
        'React Navigation 7',
        'Metro :8082',
      ],
      sources: [
        ['RootNavigator.tsx', '../../src/navigation/RootNavigator.tsx'],
        ['package.json', '../../package.json'],
      ],
    },
    {
      id: 'mera',
      layer: 'mobile',
      name: 'Mera passkey signer',
      kind: 'On-device WebAuthn + EVM',
      status: 'active',
      summary:
        'Passkey PRF derives a short-lived EVM signing session for login and reviewed Monad signatures.',
      detail:
        'The app uses the Mera RP ID moeazi-monad.kiyan.finance. PRF output, seed, and private key are cleared after session setup; the signing session exposes message, EIP-1559 transaction, and Monad Testnet typed-data signing.',
      tech: [
        '@category-labs/mera',
        'react-native-webauthn-client',
        'viem',
        'chain 10143',
      ],
      sources: [
        ['meraAuth.ts', '../../src/services/wallet/meraAuth.ts'],
        ['LOCAL_STACK.md', '../../LOCAL_STACK.md'],
      ],
    },
    {
      id: 'mobile-state',
      layer: 'mobile',
      name: 'App state and service clients',
      kind: 'Context + typed API modules',
      status: 'active',
      summary:
        'AppContext coordinates auth and screen state; API modules call Hono with versioned JSON and bearer tokens.',
      detail:
        'The app supports loading, signed-out, preview, and authenticated states. The API client refreshes Mera sessions and validates snapshots. During the current Mera rollout, AppContext pauses chain-state and autopilot actions.',
      tech: [
        'React Context',
        'fetch',
        'MOBILE_SCHEMA_VERSION',
        'Monad / Perpl clients',
      ],
      sources: [
        ['AppContext.tsx', '../../src/state/AppContext.tsx'],
        ['apiClient.ts', '../../src/services/apiClient.ts'],
        ['Monad API', '../../src/services/monadApi.ts'],
      ],
    },
    {
      id: 'session-store',
      layer: 'mobile',
      name: 'Monad-scoped session storage',
      kind: 'AsyncStorage + Keychain',
      status: 'active',
      summary:
        'Stores the access token in AsyncStorage and refresh token in device-only secure storage.',
      detail:
        'Keys are namespaced to moeazi.monad.mobile. Refresh credentials use react-native-keychain with WHEN_UNLOCKED_THIS_DEVICE_ONLY. The Mera PRF and derived owner key are not persisted.',
      tech: [
        '@react-native-async-storage/async-storage',
        'react-native-keychain',
      ],
      sources: [['sessionStore.ts', '../../src/services/sessionStore.ts']],
    },
  ],
);
