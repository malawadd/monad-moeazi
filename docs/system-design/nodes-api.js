window.SYSTEM_DESIGN.components.push(
  ...[
    {
      id: 'hono',
      layer: 'api',
      name: 'Hono mobile API',
      kind: 'Node.js · TypeScript',
      status: 'active',
      summary:
        'The active API process listens on 127.0.0.1:3102 and registers native Hono route families.',
      detail:
        'The process loads local Monad environment files, creates a Hono app, and serves it with @hono/node-server. Compose API/service hosts remain separate from the mobile host binding.',
      tech: ['Hono 4', '@hono/node-server', 'Node.js', 'port 3102'],
      sources: [
        ['server.ts', '../../backend/api-server/src/server.ts'],
        ['app.ts', '../../backend/api-server/src/app.ts'],
      ],
    },
    {
      id: 'auth-routes',
      layer: 'api',
      name: 'Mera auth and associations',
      kind: 'Challenge · session · refresh · JWKS',
      status: 'active',
      summary:
        'Mera sign-in routes and platform association endpoints are the retained Next-compatible route surface.',
      detail:
        'The legacy route loader allowlists only mobile auth challenge/session/refresh/logout and auth JWKS. Other product routes are registered directly by Hono modules. Association JSON is served at the permanent Mera RP hostname.',
      tech: [
        'Mera JWT session',
        'JWKS',
        'Android App Links',
        'iOS Universal Links',
      ],
      sources: [
        [
          'legacy-route-loader.ts',
          '../../backend/api-server/src/legacy-route-loader.ts',
        ],
        [
          'mobile auth routes',
          '../../backend/app/api/mobile/auth/session/route.ts',
        ],
        ['well-known.ts', '../../backend/api-server/src/well-known.ts'],
      ],
    },
    {
      id: 'mobile-routes',
      layer: 'api',
      name: 'Monad and Perpl mobile APIs',
      kind: 'Authenticated REST routes',
      status: 'active',
      summary:
        'Registered mobile route families expose Monad wallet, activity, markets, quotes, and Perpl venue context.',
      detail:
        'Current Hono route modules register /api/mobile/monad/* and /api/mobile/perp/*. Legacy home, account, funding, and activity handlers under the compatibility tree are not registered by the active route loader. Hono calls Convex and external reads server-side; mobile has no direct Convex or worker connection.',
      tech: ['/api/mobile/monad/*', '/api/mobile/perp/*', 'Hono registration'],
      sources: [
        ['readRoutes.ts', '../../backend/api-server/src/monad/readRoutes.ts'],
        ['perplRoutes.ts', '../../backend/api-server/src/monad/perplRoutes.ts'],
        ['app.ts', '../../backend/api-server/src/app.ts'],
        [
          'legacy-route-loader.ts',
          '../../backend/api-server/src/legacy-route-loader.ts',
        ],
      ],
    },
    {
      id: 'review-routes',
      layer: 'api',
      name: 'Owner operations and mandates',
      kind: 'Prepare · verify · submit · reconcile',
      status: 'gated',
      summary:
        'Owner transaction and mandate routes are registered; actions and broadcasts require separate local gates.',
      detail:
        'Wallet sends/swaps are prepared for review, the exact payload is signed by Mera, and Hono verifies before broadcast. Vault trading routes are operator-bridge-only. Fresh installs default actions, broadcast, and operator trade gates to false.',
      tech: [
        'Idempotency keys',
        'exact transaction verification',
        'Monad gates',
      ],
      sources: [
        ['operations.ts', '../../backend/api-server/src/monad/operations.ts'],
        ['mandates.ts', '../../backend/api-server/src/monad/mandates.ts'],
        ['config.ts', '../../backend/api-server/src/monad/config.ts'],
      ],
    },
    {
      id: 'worker-routes',
      layer: 'api',
      name: 'Internal worker and venue routes',
      kind: 'Authenticated service callbacks',
      status: 'gated',
      summary:
        'Spot, mock Perp, and Perpl worker handlers accept internal ticks and guarded execution requests.',
      detail:
        'Convex scheduled actions call Hono worker endpoints with a local shared secret. The route code is present, while each venue autonomy path also requires its independent gate and the common action/broadcast/operator gates for funded transactions.',
      tech: [
        'worker shared secret',
        'Spot autonomy gate',
        'Perp autonomy gate',
        'Perpl autonomy + direct gate',
      ],
      sources: [
        [
          'autonomyWorker.ts',
          '../../backend/api-server/src/monad/autonomyWorker.ts',
        ],
        ['perpWorker.ts', '../../backend/api-server/src/monad/perpWorker.ts'],
        ['perplWorker.ts', '../../backend/api-server/src/monad/perplWorker.ts'],
      ],
    },
  ],
);
