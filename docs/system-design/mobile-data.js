window.SYSTEM_DESIGN.mobile.push(
  ...[
    {
      name: 'Native app shell',
      type: 'React Native 0.85 · TypeScript',
      status: 'active',
      source: 'RootNavigator.tsx',
      href: '../../src/navigation/RootNavigator.tsx',
      items: [
        'Android + iOS bundle ID: com.moeazi.monad.mobile',
        'URL scheme: moeazi-monad',
        'Metro :8082 · emulator API http://10.0.2.2:3102',
      ],
    },
    {
      name: 'Navigation',
      type: 'React Navigation 7',
      status: 'active',
      source: 'RootNavigator.tsx',
      href: '../../src/navigation/RootNavigator.tsx',
      items: [
        'Tabs: Home · Markets · Agent · Activity · Account',
        'Stack: Welcome, Funding, Send, OperationReview, Wrap',
        'Vault, Spot autonomy, mock Perp, Perpl, trade review, token approval, activity detail, agent settings',
      ],
    },
    {
      name: 'State and session lifecycle',
      type: 'AppContext + typed domain state',
      status: 'active',
      source: 'AppContext.tsx',
      href: '../../src/state/AppContext.tsx',
      items: [
        'Modes: loading · signed-out · preview · authenticated',
        'Session refresh checks Mera subject/address before app entry',
        'Chain actions and autopilot methods pause during current Mera rollout',
      ],
    },
    {
      name: 'API service modules',
      type: 'Versioned REST clients',
      status: 'active',
      source: 'apiClient.ts',
      href: '../../src/services/apiClient.ts',
      items: [
        'Bearer session and 401 refresh flow',
        'Separate Monad, Spot, mock Perp, and Perpl domain clients',
        'Hono is the only mobile backend boundary; no direct Convex / Python calls',
      ],
    },
    {
      name: 'Mera sign-in and signing',
      type: 'Passkey PRF → ephemeral EVM session',
      status: 'active',
      source: 'meraAuth.ts',
      href: '../../src/services/wallet/meraAuth.ts',
      items: [
        'RP ID: moeazi-monad.kiyan.finance',
        'Signs login messages, exact EIP-1559 transactions, and Monad mandate typed data',
        'Derived secrets are cleared; signing session is ended after use',
      ],
    },
    {
      name: 'Secure session storage',
      type: 'AsyncStorage + Keychain',
      status: 'active',
      source: 'sessionStore.ts',
      href: '../../src/services/sessionStore.ts',
      items: [
        'Access: moeazi.monad.mobile.access',
        'Refresh: Keychain service moeazi.monad.mobile.refresh',
        'Device-only secure item; credentials cleared on logout / invalid refresh',
      ],
    },
  ],
);
