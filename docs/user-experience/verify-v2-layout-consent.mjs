import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createState, reduceState} from './prototype-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const act = (state, type, value) => reduceState(state, {type, value});
const cache = new Map();
async function importAsEsm(path) {
  const absolute = resolve(path);
  if (cache.has(absolute)) return cache.get(absolute);
  let source = await readFile(absolute, 'utf8');
  for (const match of [...source.matchAll(/from\s+(['"])(\.\.?\/[^'"]+)\1/g)]) {
    const child = await importAsEsm(resolve(dirname(absolute), match[2]));
    source = source.replace(match[0], `from ${JSON.stringify(child.url)}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const result = {url, module: await import(url)};
  cache.set(absolute, result);
  return result;
}

const {module: view} = await importAsEsm(resolve(here, 'prototype-view.js'));

function getDisclosure(html, className) {
  const match = html.match(new RegExp(`<details class="${className}"([^>]*)>([\\s\\S]*?)<\\/details>`));
  assert.ok(match, `${className} should contain an expandable details section`);
  assert.doesNotMatch(match[1], /(?:^|\s)open(?:\s|=|$)/i, `${className} must start collapsed`);
  return match[2];
}

const start = act(createState('funded'), 'START_STRATEGY');
const duration = act(start, 'DURATION_DRAFT', '30');
let state = act(duration, 'STRATEGY_REVIEW');
state = act(state, 'ACK');
const review = view.renderScreen(state);
const reviewDetailsAt = review.indexOf('<details');
assert.ok(reviewDetailsAt > 0);
const reviewDefault = review.slice(0, reviewDetailsAt);
for (const term of [/100\s*<small>test AUSD/i, /30 min(?:utes)?/,
  /trades up to 4×/i, /Perpl trades only · operator cannot withdraw/,
  /venue fees may apply/, /network fees in MON/i,
  /Trading may use part or all of this test balance/i]) assert.match(reviewDefault, term);
assert.equal((reviewDefault.match(/class="row/g) ?? []).length, 0,
  'the default review should have one concise summary instead of repeated technical rows');
assert.doesNotMatch(reviewDefault, /planned.loss target|Loss target/i,
  'the undefined planned-loss value must not be implied by the local fixture');
assert.doesNotMatch(review, /0\.15\s*AUSD/i, 'no unsupported planned-loss amount is fabricated');
assert.doesNotMatch(reviewDefault, /You can lose all|All 100 .* can be lost|tint-orange/i,
  'consent describes the possible balance change in calm, direct language');
const limits = getDisclosure(review, 'strategy-review-details');
assert.match(limits, /Maximum margin/); assert.match(limits, /Maximum position/);
assert.match(limits, /Planned loss target[\s\S]*Server-configured · exact value unavailable in this demo; not a guaranteed cap/i,
  'the unavailable loss target and non-guarantee caveat must stay together in the disclosure');
assert.match(limits, /Exact network fees/);

state = act(state, 'RUN_START');
const provider = view.renderScreen(state);
const providerDetailsAt = provider.indexOf('<details');
assert.ok(providerDetailsAt > 0);
const providerDefault = provider.slice(0, providerDetailsAt);
for (const term of [/Fund 100 AUSD/, /Test tokens/, /30 min(?:utes)?/, /Up to 4×/,
  /operator cannot withdraw/, /owner network fee in MON/i]) assert.match(providerDefault, term);
assert.equal((providerDefault.match(/class="row/g) ?? []).length, 0,
  'the provider default should not repeat the full technical row list');
assert.doesNotMatch(providerDefault, /Maximum margin|Maximum position|Monad Testnet/);
const exactRequest = getDisclosure(provider, 'strategy-provider-details');
assert.match(exactRequest, /Maximum margin/); assert.match(exactRequest, /Maximum position/);
assert.match(exactRequest, /funding transaction and typed trading-mandate signature/i);

const markets = view.renderScreen({...createState('funded'), route: 'markets'});
const marketList = markets.match(/<section class="market-list"[^>]*>([\s\S]*?)<\/section>/)?.[1];
assert.ok(marketList);
assert.doesNotMatch(marketList, /<svg|class="spark/i,
  'market-list rows should omit mini charts so they cannot crowd names or prices');
const rows = [...marketList.matchAll(/<article class="market-item">([\s\S]*?)<\/article>/g)].map(match => match[1]);
assert.ok(rows.length >= 3);
for (const row of rows) assert.match(row, /<span class="market-copy">[\s\S]*?<\/span><span class="market-price">/,
  'asset name and quote should have separate structural regions');
const css = await readFile(resolve(here, 'prototype-v2.css'), 'utf8');
const inputCss = await readFile(resolve(here, 'prototype-inputs.css'), 'utf8');
assert.match(inputCss, /\.same-route-render\s+\.screen\s*\{[^}]*animation\s*:\s*none/i,
  'same-route numeric edits do not replay the screen entrance motion');
assert.match(css, /html\.reduced-motion\s+\*[^}]*animation-duration:\.01ms/i);
assert.match(css, /@media\(prefers-reduced-motion:reduce\)/i);
assert.match(css, /\.market-hit\{[^}]*grid-template-areas:"icon copy" "price price"/);
assert.match(css, /\.market-item>\.watch-button\{[^}]*width:48px[^}]*min-height:48px/);

const market = {...createState('funded'), route: 'market-detail', selectedMarket: 'ETH-PERP', marketTimeframe: '7D'};
const line = view.renderScreen({...market, chartStyle: 'line'});
const candles = view.renderScreen({...market, chartStyle: 'candles'});
const panel = html => html.match(/<section class="chart-panel"[\s\S]*?<\/section>/)?.[0];
const linePanel = panel(line); const candlePanel = panel(candles);
assert.match(linePanel, /data-chart-style="line"/); assert.match(linePanel, /<polyline/);
assert.match(candlePanel, /data-chart-style="candles"/); assert.doesNotMatch(candlePanel, /<polyline/);
assert.match(candlePanel, /Synthetic OHLC; wick values are illustrative/);
assert.equal((candlePanel.match(/<g>/g) ?? []).length, 6);
const quoteSummary = html => html.match(/<div class="detail-facts compact-facts"[^>]*>[\s\S]*?<\/div>/)?.[0];
assert.equal(quoteSummary(line), quoteSummary(candles), 'chart style should not change the quote window or range');

console.log('Compact market and consent presentation checks passed. HTML/CSS structure was inspected; no browser or pixel QA was performed.');
