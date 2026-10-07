// Read-only Perpl Testnet coverage while private API enrollment is unavailable.
const base = 'https://testnet.perpl.xyz/api';
const now = Date.now();
const from = now - 60 * 60 * 1000;

async function get(path) {
  const response = await fetch(base + path, {signal: AbortSignal.timeout(12_000)});
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return body;
}

async function probe(name, path, summarize) {
  try {
    const body = await get(path);
    return {name, status: 'observed', ...summarize(body)};
  } catch (error) {
    return {name, status: 'blocked', reason: error instanceof Error ? error.message : String(error)};
  }
}

async function publicSocket(marketId) {
  if (typeof WebSocket !== 'function') return {name: 'public WebSocket', status: 'blocked', reason: 'No WebSocket in Node runtime'};
  const streams = [`heartbeat@10143`, `gas-stats@10143`, `market-config@10143`,
    `market-state@10143`, `order-book@${marketId}`, `trades@${marketId}`,
    `candles@${marketId}*60`, `funding@10143`];
  return await new Promise(resolve => {
    const socket = new WebSocket('wss://testnet.perpl.xyz/ws/v1/market-data');
    const frames = new Set();
    let subscriptions = [];
    let done = false;
    const finish = (reason) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      const accepted = subscriptions.filter(row => row.status?.code === 0).length;
      resolve({name: 'public WebSocket', status: accepted === streams.length ? 'observed'
        : accepted === streams.length - 1 ? 'partial' : 'blocked',
        streams: subscriptions.map(row => ({stream: row.stream, code: row.status?.code})),
        frameTypes: [...frames], ...(reason ? {reason} : {})});
    };
    const timer = setTimeout(() => finish('Snapshot window expired'), 8_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({mt: 5,
      subs: streams.map(stream => ({stream, subscribe: true}))})));
    socket.addEventListener('message', event => {
      try {
        const frame = JSON.parse(String(event.data));
        if (frame.mt === 6) subscriptions = frame.subs ?? [];
        if (Number.isInteger(frame.mt)) frames.add(frame.mt);
        if (subscriptions.length === streams.length && frames.has(9) && frames.has(15)) finish();
      } catch { /* malformed public frame is not evidence */ }
    });
    socket.addEventListener('error', () => finish('WebSocket error'));
    socket.addEventListener('close', () => finish('WebSocket closed'));
  });
}

const context = await probe('context', '/v1/pub/context', data => ({
  chainId: Number(data?.chain?.chain_id), marketIds: (data?.markets ?? []).map(row => row.id),
  collateral: (data?.tokens ?? []).find(row => row.symbol === 'AUSD')?.address ?? null,
}));
if (context.status !== 'observed' || context.chainId !== 10143 || !context.marketIds?.length) {
  process.stdout.write(JSON.stringify({checkedAt: new Date().toISOString(), results: [context]}, null, 2) + '\n');
  process.exitCode = 1;
} else {
  const marketId = context.marketIds.includes(16) ? 16 : context.marketIds[0];
  const checks = [
    ['all-market ticker', '/v1/market-data/ticker', data => ({marketCount: Object.keys(data?.d ?? {}).length, block: data?.sn})],
    ['single-market ticker', `/v1/market-data/${marketId}/ticker`, data => ({marketId, block: data?.sn})],
    ['order book', `/v1/market-data/${marketId}/book?levels=10`, data => ({marketId, block: data?.sn, bids: data?.bid?.length, asks: data?.ask?.length})],
    ['one-minute candles', `/v1/market-data/${marketId}/candles/60/${from}-${now}`, data => ({marketId, candles: data?.d?.length ?? 0})],
    ['market funding', `/v1/market-data/${marketId}/funding/${from}-${now}`, data => ({marketId, events: data?.d?.length ?? 0})],
    ['all-market funding', `/v1/market-data/funding/${from}-${now}`, data => ({markets: Object.keys(data?.d ?? {}).length})],
    ['announcements', '/v1/profile/announcements', data => ({active: data?.active?.length ?? 0})],
  ];
  const results = [context];
  for (const [name, path, summarize] of checks) results.push(await probe(name, path, summarize));
  results.push(await publicSocket(marketId));
  process.stdout.write(JSON.stringify({checkedAt: new Date().toISOString(), marketId, results}, null, 2) + '\n');
  if (results.some(row => row.status === 'blocked')) process.exitCode = 1;
}
