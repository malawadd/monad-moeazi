window.SYSTEM_DESIGN.components.push(
  ...[
    {
      id: 'monad-testnet',
      layer: 'external',
      name: 'Monad Testnet',
      kind: 'EVM chain · chain ID 10143',
      status: 'active',
      summary:
        'Owner-reviewed transfers, wrap/unwrap, swaps, vault custody, and controlled test workers target Monad Testnet.',
      detail:
        'The API pins RPC use to the official Monad Testnet endpoint. Deployment manifests pin addresses, code hashes, and receipts for the owner vault and test venues. The chain is reachable for reads; broadcasts require local gates.',
      tech: [
        'Monad Testnet RPC',
        'chain ID 10143',
        'USDC / WMON',
        'verified manifests',
      ],
      sources: [
        ['Monad constants', '../../backend/api-server/src/monad/constants.ts'],
        [
          'Testnet manifest',
          '../../backend/contracts/monad-testnet/deployments/manifest.testnet.json',
        ],
        ['LOCAL_STACK.md', '../../LOCAL_STACK.md'],
      ],
    },
    {
      id: 'perpl-venue',
      layer: 'external',
      name: 'Perpl Testnet',
      kind: 'AUSD venue · public API + direct transport',
      status: 'active',
      summary:
        'Public market context, prices, books, candles, and funding history are readable without an API key.',
      detail:
        'The integration is pinned to testnet.perpl.xyz. Public markets stay available; order execution and settlement are gated. Direct onchain Perpl Testnet is an optional path with its own switch.',
      tech: [
        'testnet.perpl.xyz/api',
        'AUSD',
        'public reads active',
        'execution gated',
      ],
      sources: [
        ['Perpl config', '../../backend/api-server/src/monad/perplConfig.ts'],
        ['Perpl routes', '../../backend/api-server/src/monad/perplRoutes.ts'],
        [
          'Perpl deployment',
          '../../backend/contracts/monad-testnet/deployments/manifest.perpl.strategy.testnet.json',
        ],
      ],
    },
    {
      id: 'provider-apis',
      layer: 'external',
      name: 'Optional model-provider APIs',
      kind: 'External inference services',
      status: 'gated',
      summary:
        'OpenAI, DeepSeek, and OpenRouter can serve selected agent roles after local credentials and budgets are configured.',
      detail:
        'Provider calls are outside the mobile request path and are not required for Mera sign-in, account/market reads, or owner transaction review. Fresh local config keeps keys blank and controls costs with Lite Mode and Manual Guard.',
      tech: ['OpenAI', 'DeepSeek', 'OpenRouter', 'keys blank by default'],
      sources: [
        [
          'Compose provider configuration',
          '../../backend/docker-compose.agents.yml',
        ],
        ['model routing', '../../backend/convex/helpers/modelRouting.ts'],
      ],
    },
    {
      id: 'migration-path',
      layer: 'external',
      name: 'Legacy wallet / Arbitrum compatibility',
      kind: 'Dormant migration surface',
      status: 'retained',
      summary:
        'A few typed compatibility fields and connector paths remain from the earlier Arbitrum/Magic stack.',
      detail:
        'Mera is the current mobile identity. Empty Magic and Arbitrum config values keep dormant modules type-compatible during migration. The active Monad mobile flow does not use Arbitrum as its chain.',
      tech: ['Magic key empty', 'Arbitrum RPC empty', 'migration only'],
      sources: [
        ['src/config.ts', '../../src/config.ts'],
        ['LOCAL_STACK.md', '../../LOCAL_STACK.md'],
      ],
    },
  ],
);
