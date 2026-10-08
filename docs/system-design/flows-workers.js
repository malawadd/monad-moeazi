window.SYSTEM_DESIGN.flows.push(
  ...[
    {
      id: 'spot',
      title: 'Spot testnet worker',
      summary:
        'Convex dispatches a scheduled Hono tick. The enrolled Spot vault can act only within an owner-signed mandate and enabled testnet gates.',
      steps: [
        {
          name: 'Owner enrollment',
          description:
            'The owner funds and explicitly activates a vault under a bounded, direction-specific Spot mandate. New local setups have transaction gates off.',
          nodes: ['mobile-app', 'mera', 'convex-monad', 'mandate-boundary'],
          edges: ['api-convex', 'spot-mandate'],
        },
        {
          name: 'Scheduled evaluation',
          description:
            'A Convex scheduled action sends a secret-authenticated tick to the Hono Spot worker route; the worker reads its scoped run and market context.',
          nodes: [
            'convex-monad',
            'spot-worker',
            'worker-routes',
            'hono',
            'monad-testnet',
          ],
          edges: ['convex-tick', 'api-monad'],
        },
        {
          name: 'Guarded execution and evidence',
          description:
            'Only a fresh quote and mandate-bounded order can proceed through common action, broadcast, and operator gates. Convex records the result and finality.',
          nodes: [
            'spot-worker',
            'mandate-boundary',
            'review-routes',
            'monad-testnet',
            'convex-monad',
          ],
          edges: ['spot-mandate', 'execution-rpc', 'api-convex'],
        },
      ],
    },
    {
      id: 'perp',
      title: 'Mock Perp testnet worker',
      summary:
        'A separate test-only clearinghouse, vault, mandate, and worker path with its own independent gate.',
      steps: [
        {
          name: 'Separate enrollment and vault',
          description:
            'The owner enrolls for the mock Perp program. Its account records, vault, manifest, and policy are separate from Spot.',
          nodes: [
            'mobile-app',
            'mera',
            'convex-monad',
            'perp-worker',
            'mandate-boundary',
          ],
          edges: ['api-convex', 'perp-mandate'],
        },
        {
          name: 'Read MZA / MZB / MZG pool context',
          description:
            'The worker evaluates the test-only mock clearinghouse state and applies deterministic policy and exposure rules.',
          nodes: [
            'perp-worker',
            'worker-routes',
            'convex-monad',
            'monad-testnet',
          ],
          edges: ['convex-tick', 'api-monad'],
        },
        {
          name: 'Execute only when all gates allow',
          description:
            'Perp autonomy has its own default-off switch; funded execution also needs action, broadcast, and operator-trade gates.',
          nodes: [
            'perp-worker',
            'review-routes',
            'mandate-boundary',
            'monad-testnet',
          ],
          edges: ['perp-mandate', 'execution-rpc'],
        },
      ],
    },
    {
      id: 'perpl',
      title: 'Perpl Testnet worker',
      summary:
        'Public market data is separate from trading. Execution can use Perpl API transport or the optional direct onchain path.',
      steps: [
        {
          name: 'Load public Perpl context',
          description:
            'Mobile markets and workers can read public context, prices, order books, candles, and funding history without an API key.',
          nodes: ['mobile-app', 'mobile-routes', 'perpl-venue', 'perpl-worker'],
          edges: ['client-api', 'api-perpl'],
        },
        {
          name: 'Check separate enrollment and transport',
          description:
            'Perpl autonomy is default off. API transport requires a configured whitelisted origin; direct onchain transport has its own switch.',
          nodes: [
            'perpl-worker',
            'worker-routes',
            'convex-monad',
            'review-routes',
          ],
          edges: ['convex-tick', 'perpl-direct'],
        },
        {
          name: 'Verify approval, order, and settlement',
          description:
            'The worker remains inside the owner mandate and common transaction gates; only verified receipts/fills count as execution.',
          nodes: [
            'perpl-worker',
            'mandate-boundary',
            'perpl-venue',
            'convex-monad',
          ],
          edges: ['perpl-direct', 'api-convex'],
        },
      ],
    },
  ],
);
