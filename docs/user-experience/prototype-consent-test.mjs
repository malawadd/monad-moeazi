import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createState} from './prototype-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
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
  const module = {url, exports: await import(url)};
  cache.set(absolute, module);
  return module;
}

const home = await importAsEsm(resolve(here, 'prototype-screens-home.js'));
const signing = await importAsEsm(resolve(here, 'prototype-screens-signing.js'));
const review = home.exports.renderStrategyReview({...createState('funded'), route: 'strategy-review', durationMinutes: 720});
assert.match(review, /100 <small>test AUSD<\/small>/);
assert.match(review, /12 hr/);
assert.match(review, /Wallet/); assert.match(review, /Strategy vault/);
assert.match(review, /Automated Perpl trades|Perpl trades only/);
assert.match(review, /operator cannot withdraw/);
assert.match(review, /Trading may use part or all of this test balance/);
assert.match(review, /0% Moeazi.*venue fees.*network fees in MON/);
assert.match(review, /<details class="strategy-review-details"[^>]*><summary>How practice funds work/);
const limitsStart = review.indexOf('<details class="strategy-review-details"');
const limitsEnd = review.indexOf('</details>', limitsStart);
assert.match(review.slice(limitsStart, limitsEnd), /some or all of the 100 test AUSD allocation/);
assert.match(review.slice(limitsStart, limitsEnd), /Planned loss target[\s\S]*exact value unavailable in this demo[\s\S]*not a guaranteed cap/);
assert.doesNotMatch(review, /0\.15 AUSD per cycle/);
assert.doesNotMatch(review.slice(0, limitsStart), /guaranteed cap/);
assert.doesNotMatch(review, /<details[^>]*(?:^|\s)open(?:\s|=|>)/i);
assert.doesNotMatch(review, /Your plan|Risk and permissions/);
assert.match(review, /data-action="run-start"[^>]*disabled/);
assert.doesNotMatch(review, /<input[^>]*type="range"/);

const provider = signing.exports.renderProviderHandoff({
  route: 'provider-handoff', durationMinutes: 720,
  signingOperation: {submitAction: 'RUN_START', prepared: {durationMinutes: 720},
    providerSteps: 'One Mera unlock, then funding and mandate signatures.'}
});
assert.match(provider, /Fund 100 AUSD/);
assert.match(provider, /Allow Perpl trades for 12 hr/);
assert.doesNotMatch(provider, /You can lose all 100 test AUSD/);
assert.match(provider, /operator cannot withdraw/);
assert.match(provider, /One Mera unlock/);
assert.match(provider, /<details class="strategy-provider-details"><summary>Exact request details/);
assert.doesNotMatch(provider, /<details[^>]*(?:^|\s)open(?:\s|=|>)/i);
assert.match(provider, /funding transaction and typed trading-mandate signature/);
assert.doesNotMatch(provider, /REQUEST DETAILS/);
assert.match(provider, /data-action="signing-approve"/);
assert.match(provider, /data-action="signing-cancel"/);
console.log('Strategy consent review and provider handoff checks passed.');
