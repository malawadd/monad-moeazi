import {button, esc, head, layout} from './prototype-helpers.js';
export {renderStrategies, renderStrategyDetail, renderStrategySetup} from './prototype-screens-strategy-marketplace.js';

const marketData = [
  {
    key: 'BTC-PERP', name: 'Bitcoin', symbol: '₿', venue: 'Perpl', tint: 'pink',
    quote: 64820, quoteUnit: 'AUSD per BTC', quoteSymbol: 'AUSD/BTC', decimals: 2,
    listQuote: '64,820 AUSD', headlineQuote: '64,820.00 AUSD/BTC',
    series: {
      '1H': [1, 1.001, .997, 1.003, 1.002, 1.005, 1.006],
      '24H': [1, 1.004, .998, 1.006, 1.011, 1.009, 1.014],
      '7D': [1, .984, .992, 1.006, 1.003, 1.025, 1.032],
    },
  },
  {
    key: 'ETH-PERP', name: 'Ethereum', symbol: 'Ξ', venue: 'Perpl', tint: 'mint',
    quote: 3420, quoteUnit: 'AUSD per ETH', quoteSymbol: 'AUSD/ETH', decimals: 2,
    listQuote: '3,420 AUSD', headlineQuote: '3,420.00 AUSD/ETH',
    series: {
      '1H': [1, 1.001, .999, 1.004, 1.002, 1.006, 1.002],
      '24H': [1, .997, 1.003, 1.006, 1.004, 1.009, 1.006],
      '7D': [1, .982, .998, 1.013, 1.021, 1.018, 1.024],
    },
  },
  {
    key: 'USDC/WMON', name: 'Wrapped MON', symbol: 'M', venue: 'Spot', tint: 'yellow',
    quote: 4, quoteUnit: 'WMON per USDC', quoteSymbol: 'WMON/USDC', decimals: 4,
    listQuote: '4 WMON per USDC', headlineQuote: '1 USDC = 4.0000 WMON',
    series: {
      '1H': [1, .9995, 1.001, 1.0002, 1.0015, 1.0008, 1.001],
      '24H': [1, .998, 1.001, 1.0005, 1.002, 1.0015, 1.003],
      '7D': [1, .994, .997, 1.003, 1.002, 1.006, 1.008],
    },
  },
];
const periods = ['1H', '24H', '7D'];
const periodLabels = {'1H': '1 hour', '24H': '24 hours', '7D': '7 days'};

function spark(points, item, period, large = false) {
  const width = large ? 320 : 72;
  const height = large ? 116 : 32;
  const high = Math.max(...points); const low = Math.min(...points); const range = Math.max(1e-5, high - low);
  const coords = points.map((value, index) => `${index * width / (points.length - 1)},${8 + ((high - value) / range) * (height - 16)}`).join(' ');
  const label = `Illustrative ${item.name} ${periodLabels[period]} price in ${item.quoteUnit}. Source: fixture data, no live quotes.`;
  return `<svg class="spark ${large ? 'spark-large chart-line' : ''}" data-chart-style="line" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><polyline class="chart-line-path" points="${coords}" fill="none" stroke-width="${large ? 4 : 3}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function candleChart(points, item, period) {
  const width = 320; const height = 116;
  const high = Math.max(...points); const low = Math.min(...points); const range = Math.max(1e-5, high - low);
  const y = value => height - 8 - ((value - low) / range) * (height - 16);
  const slot = width / (points.length - 1); const bodyWidth = Math.min(24, slot * .45);
  const candles = points.slice(1).map((close, index) => {
    const open = points[index];
    const bodyHigh = Math.max(open, close); const bodyLow = Math.min(open, close);
    const wick = Math.max(range * .035, Math.abs(close - open) * .35);
    const candleHigh = Math.min(high, bodyHigh + wick); const candleLow = Math.max(low, bodyLow - wick);
    const x = slot * (index + .5); const top = y(bodyHigh); const bottom = y(bodyLow);
    const direction = close >= open ? 'up' : 'down';
    return `<g><line class="chart-candle-wick" x1="${x}" y1="${y(candleHigh)}" x2="${x}" y2="${y(candleLow)}" stroke-width="2"/><rect class="chart-candle-${direction}" x="${x - bodyWidth / 2}" y="${top}" width="${bodyWidth}" height="${Math.max(2, bottom - top)}" stroke-width="2"/></g>`;
  }).join('');
  const label = `Illustrative ${item.name} ${periodLabels[period]} synthetic OHLC candles in ${item.quoteUnit}; opens and closes follow consecutive fixture quotes, wick values are illustrative. No live data.`;
  return `<svg class="spark spark-large chart-candles" data-chart-style="candles" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${candles}</svg>`;
}
// Each period is a fixture price path relative to its start; scale it so the last point equals the headline quote.
function quoteWindow(item, period) {
  const relative = item.series[period] ?? item.series['24H'];
  const anchor = item.quote / relative.at(-1);
  const points = relative.map(value => value * anchor);
  points[points.length - 1] = item.quote;
  return {points, start: points[0], end: item.quote, low: Math.min(...points), high: Math.max(...points)};
}
const formatQuote = (item, value) => `${Number(value).toLocaleString('en-US', {minimumFractionDigits: item.decimals, maximumFractionDigits: item.decimals})} ${item.quoteSymbol}`;
function changeLabel(item) {
  const {points} = quoteWindow(item, '24H');
  const change = (points.at(-1) / points[0] - 1) * 100;
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
}
function selectedMarket(state) { return marketData.find(item => item.key === state.selectedMarket) ?? marketData[0]; }
function marketRows(state) {
  const q = (state.search ?? '').trim().toLowerCase();
  return marketData.filter(item => {
    const filter = state.marketFilter ?? 'All';
    const matchesFilter = filter === 'All' || filter === item.venue || filter === 'Watchlist' && (state.watchlist ?? []).includes(item.key);
    return matchesFilter && `${item.name} ${item.key} ${item.venue}`.toLowerCase().includes(q);
  });
}

export function renderMarkets(state) {
  const filters = ['All', 'Spot', 'Perpl', 'Watchlist'];
  const selectedFilter = state.marketFilter ?? 'All';
  const rows = marketRows(state);
  return layout(`${head('MARKETS', 'Markets', 'Browse spot assets and Perpl markets.', '', 'catalog-head')}
    <label class="sr-only" for="market-search">Search assets</label><input id="market-search" class="search-input" type="search" data-field="search" value="${esc(state.search ?? '')}" placeholder="Search assets" autocomplete="off">
    <div class="catalog-filters" role="group" aria-label="Filter markets">${filters.map(filter => button(filter, 'market-filter', `filter-chip ${selectedFilter === filter ? 'is-selected' : ''}`, false, filter, `aria-pressed="${selectedFilter === filter}"`)).join('')}</div>
    <section class="market-list" aria-label="Markets">${rows.length ? rows.map(item => {
      const watched = (state.watchlist ?? []).includes(item.key);
      return `<article class="market-item"><button class="market-hit" type="button" data-action="market-detail" data-value="${esc(item.key)}" aria-label="Open ${esc(item.name)} ${esc(item.key)} details"><span class="coin-mark ${item.tint}" aria-hidden="true">${item.symbol}</span><span class="market-copy"><strong>${esc(item.name)}</strong><small>${esc(item.key)} · ${item.venue}</small></span><span class="market-price"><strong>${esc(item.listQuote)}</strong><small>${changeLabel(item)} · 24H fixture</small></span></button><button class="watch-button" type="button" data-action="watch" data-value="${esc(item.key)}" aria-pressed="${watched}" aria-label="${watched ? 'Remove' : 'Add'} ${esc(item.name)} ${watched ? 'from' : 'to'} watchlist">${watched ? '★' : '☆'}</button></article>`;
    }).join('') : '<p class="market-empty">No matching assets. Try another name or filter.</p>'}</section>
    <p class="catalog-footnote">Illustrative fixtures · no live quotes</p>`);
}

export function renderMarketDetail(state) {
  const item = selectedMarket(state);
  const time = periods.includes(state.marketTimeframe) ? state.marketTimeframe : '24H';
  const window = quoteWindow(item, time);
  const chartStyle = state.chartStyle === 'candles' ? 'candles' : 'line';
  const watch = (state.watchlist ?? []).includes(item.key);
  const spot = item.venue === 'Spot';
  const tradeEnabled = item.key !== 'ETH-PERP';
  return layout(`${head(`${item.venue.toUpperCase()} · ${item.key}`, item.name, `${item.key} · ${item.venue} · illustrative market data`, 'markets', 'detail-head')}
    <section class="detail-quote"><div><span class="detail-metric-label">Fixture quote · ${esc(item.quoteUnit)}</span><strong class="detail-metric">${esc(item.headlineQuote)}</strong></div><button class="watch-button" type="button" data-action="watch" data-value="${esc(item.key)}" aria-pressed="${watch}" aria-label="${watch ? 'Remove from' : 'Add to'} watchlist">${watch ? '★' : '☆'}</button></section>
    <section class="chart-panel" data-chart-style="${chartStyle}"><div class="chart-context"><span>${esc(item.name)} · ${periodLabels[time]} window</span><small>Quote unit: ${esc(item.quoteUnit)} · Source: illustrative fixture · ${chartStyle === 'candles' ? 'Synthetic OHLC; wick values are illustrative' : 'Line joins fixture quote samples'}</small></div>${chartStyle === 'candles' ? candleChart(window.points, item, time) : spark(window.points, item, time, true)}<div class="period-chips" role="group" aria-label="Chart timeframe">${periods.map(value => button(value, 'market-timeframe', `period-chip ${time === value ? 'is-selected' : ''}`, false, value, `aria-pressed="${time === value}"`)).join('')}</div></section>
    <div class="detail-facts compact-facts" role="group" aria-label="${esc(item.name)} ${periodLabels[time]} quote summary"><span>Window start</span><strong>${formatQuote(item, window.start)}</strong><span>Window end</span><strong>${esc(item.headlineQuote)}</strong><span>Window range</span><strong>${formatQuote(item, window.low)} – ${formatQuote(item, window.high)}</strong></div>
    <p class="catalog-footnote">Illustrative fixture · no live quotes</p>
    <div class="detail-facts"><span>Market</span><strong>${spot ? 'Spot swap · no leverage' : 'Perpetual · collateral and funding apply'}</strong><span>Venue</span><strong>${item.venue}</strong></div>
    ${spot ? button('Set up a spot swap', 'nav-spot-setup', 'pink') : tradeEnabled ? button('Open BTC Perpl account', 'nav-manual-account', 'pink') : '<p class="inline-state">ETH Perpl trading is not available in this preview.</p>'}
    <button class="button-link" data-action="tab" data-value="Markets">Back to markets</button>`);
}

const statusClass = status => /confirm|fill|active|settled|received|complete|open|closed/i.test(status) ? 'status-good' : /cancel|reject|fail/i.test(status) ? 'status-muted' : 'status-wait';
const eventAmount = item => item.amount ? `<strong class="activity-amount">${esc(item.amount)}</strong>` : '';
export function renderActivity(state) {
  const items = [...(state.events ?? [])].sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
  const rows = items.map(item => `<button class="activity-row-v2" type="button" data-action="receipt" data-value="${esc(item.id)}"><span class="activity-dot ${statusClass(item.status)}" aria-hidden="true"></span><span class="activity-main-v2"><strong>${esc(item.title)}</strong><small>${esc(item.at ?? 'Preview')}</small></span>${eventAmount(item)}<span class="activity-status ${statusClass(item.status)}">${esc(shortStatus(item.status))}</span><span aria-hidden="true">›</span></button>`).join('');
  return layout(`${head('ACTIVITY', 'Recent activity', 'Requests, confirmations, and strategy updates.', '', 'catalog-head')}
    ${items.length ? `<h2 class="activity-group-title">TODAY · LOCAL PREVIEW</h2><section class="activity-list" aria-label="Recent activity">${rows}</section>` : `<section class="activity-empty"><span class="empty-icon" aria-hidden="true">↗</span><strong>No activity yet</strong><p>Your requests and updates will appear here.</p></section>`}
    ${state.pendingOrder ? `<button class="pending-notice" type="button" data-action="order-pending"><strong>One operation needs a status check</strong><small>Check the same operation before trying again.</small></button>` : ''}`);
}
function shortStatus(status = '') {
  return status.replace(/ · (demo fixture|demo|fixture)/ig, '').replace('Finalized', 'Confirmed').replace('Start requested', 'Requested').replace('Settlement checking', 'Settling');
}

export function renderReceipt(state) {
  const item = (state.events ?? []).find(entry => entry.id === state.selectedEvent) ?? state.events?.[0];
  if (!item) return layout(`${head('ACTIVITY', 'No receipt yet', 'A receipt appears after an operation.', 'activity', 'detail-head')}`);
  const timeline = (item.timeline ?? [{status: item.status, detail: item.detail, at: item.at}]).map(step => `<li><span class="timeline-mark ${statusClass(step.status)}"></span><span><strong>${esc(shortStatus(step.status))}</strong><small>${esc(step.detail ?? '')}</small></span><time>${esc(step.at ?? '')}</time></li>`).join('');
  return layout(`${head('ACTIVITY · OPERATION', item.title, 'Local preview record · not a chain receipt', 'activity', 'detail-head')}
    <section class="receipt-summary"><span class="activity-status ${statusClass(item.status)}">${esc(shortStatus(item.status))}</span>${item.amount ? `<strong>${esc(item.amount)}</strong>` : ''}<p>${esc(item.detail ?? '')}</p></section>
    <h2 class="activity-group-title">STATUS TIMELINE</h2><ol class="receipt-timeline">${timeline}</ol>
    <button class="button-link" data-action="tab" data-value="Activity">Back to Activity</button>`);
}
