window.SYSTEM_DESIGN.flows.push(
  ...[
    {
      id: 'signin',
      title: 'Mera passkey sign-in',
      summary:
        'Create a passkey or unlock an existing credential, prove wallet ownership, and establish a short-lived API session.',
      steps: [
        {
          name: 'Open a device-bound signing session',
          description:
            'The app asks the platform WebAuthn provider for Mera PRF output, derives an EVM address, and holds the signing key only in a short-lived session.',
          nodes: ['mobile-app', 'mera'],
          edges: [],
        },
        {
          name: 'Request and sign a challenge',
          description:
            'The app sends the address and device identity to Hono, then signs the returned challenge message with the Mera session.',
          nodes: ['mobile-app', 'mera', 'hono', 'auth-routes'],
          edges: ['client-api', 'passkey-auth'],
        },
        {
          name: 'Verify and issue the session',
          description:
            'The auth route validates the challenge, returns access/refresh tokens, and the app checks the subject is the matching mera: address.',
          nodes: ['auth-routes', 'hono', 'convex'],
          edges: ['api-convex'],
        },
        {
          name: 'Persist only session tokens',
          description:
            'The access token goes to Monad-scoped AsyncStorage; the refresh token goes to device-only Keychain storage. PRF, seed, and owner key are erased.',
          nodes: ['session-store', 'mobile-app', 'mera'],
          edges: ['session-client'],
        },
      ],
    },
    {
      id: 'reads',
      title: 'Wallet and market reads',
      summary:
        'The mobile client calls the registered Monad and Perpl Hono route families; Hono composes Convex state with chain or venue reads.',
      steps: [
        {
          name: 'Mobile request',
          description:
            'A screen calls the Monad or Perpl API client with its current bearer session.',
          nodes: ['mobile-app', 'mobile-state', 'hono', 'mobile-routes'],
          edges: ['client-api'],
        },
        {
          name: 'Load Monad records',
          description:
            'Hono validates Mera identity and queries Monad-scoped Convex records for activity and agent context.',
          nodes: ['hono', 'mobile-routes', 'convex', 'convex-monad'],
          edges: ['api-convex'],
        },
        {
          name: 'Read wallet and market data',
          description:
            'Monad wallet, market, and quote handlers use the official testnet RPC. Perpl public context can load without an API key.',
          nodes: ['mobile-routes', 'hono', 'monad-testnet', 'perpl-venue'],
          edges: ['api-monad', 'api-perpl'],
        },
      ],
    },
    {
      id: 'owner-op',
      title: 'Owner-reviewed transaction',
      summary:
        'Each wallet operation has a visible intent, exact Mera signature, server-side validation, and a persisted operation identity.',
      steps: [
        {
          name: 'Prepare a bounded operation',
          description:
            'Hono checks the action gate, validates the requested operation and idempotency key, then builds a short-lived exact transaction for review.',
          nodes: [
            'mobile-app',
            'mobile-routes',
            'review-routes',
            'hono',
            'convex',
          ],
          edges: ['client-api', 'api-convex'],
        },
        {
          name: 'Review and sign on device',
          description:
            'The owner sees the transaction details and Mera signs the exact EIP-1559 payload for Monad Testnet.',
          nodes: ['mobile-app', 'mera', 'owner-boundary'],
          edges: ['review-submit'],
        },
        {
          name: 'Verify and broadcast',
          description:
            'Hono checks signature, owner, chain, expiry, and stored intent. Broadcast requires the separate local broadcast gate.',
          nodes: ['review-routes', 'owner-boundary', 'hono', 'monad-testnet'],
          edges: ['execution-rpc'],
        },
        {
          name: 'Reconcile finality',
          description:
            'The operation ID is reused to observe pending, uncertain, or finalized state; retries do not create a second transaction.',
          nodes: ['convex', 'convex-monad', 'mobile-routes'],
          edges: ['api-convex'],
        },
      ],
    },
    {
      id: 'vault',
      title: 'Vault mandate and operator trade',
      summary:
        'The owner signs a scoped mandate; the local operator bridge prepares capped vault operations and reconciles one operation ID.',
      steps: [
        {
          name: 'Review the vault and mandate',
          description:
            'The owner chooses a specific Spot or mock Perp scope, fixed direction, funding cap, and duration. A fresh mandate needs a new Mera signature.',
          nodes: ['mobile-app', 'mera', 'mandate-boundary', 'convex-monad'],
          edges: ['api-convex'],
        },
        {
          name: 'Quote and prepare through operator bridge',
          description:
            'The authenticated local console requests a fresh venue quote and a capped order through Hono operator routes.',
          nodes: ['operator', 'hono', 'review-routes', 'mandate-boundary'],
          edges: ['op-proxy', 'spot-mandate'],
        },
        {
          name: 'Submit exact payload and reconcile',
          description:
            'The operator bridge submits the exact prepared payload under the separate operator trade/broadcast gates, then checks the same operation ID.',
          nodes: ['operator', 'hono', 'convex-monad', 'monad-testnet'],
          edges: ['op-proxy', 'api-convex', 'api-monad'],
        },
      ],
    },
  ],
);
