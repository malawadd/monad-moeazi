import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const read = name => readFile(resolve(here, name), 'utf8');
const imported = new Map();
async function importAsEsm(path) {
  const file = resolve(path);
  if (imported.has(file)) return imported.get(file);
  let source = await readFile(file, 'utf8');
  for (const match of [...source.matchAll(/from\s+(['"])(\.\.?\/[^'"]+)\1/g)]) {
    const child = await importAsEsm(resolve(dirname(file), match[2]));
    source = source.replace(match[0], `from ${JSON.stringify(child.url)}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const result = {url, module: await import(url)};
  imported.set(file, result);
  return result;
}

class ElementStub {
  constructor(selector = '') { this.selector = selector; this.dataset = {}; this.listeners = {}; this.classList = {toggle() {}, contains() { return false; }}; this.inputNodes = []; this.details = []; this.actionElements = []; this.scrollTop = 0; this.hidden = false; this.value = ''; this.textContent = ''; this._html = ''; }
  set innerHTML(html) {
    this._html = String(html); this.inputNodes = []; this.details = []; this.actionElements = [];
    const attrs = raw => Object.fromEntries([...raw.matchAll(/([\w-]+)(?:\s*=\s*"([^"]*)")?/g)].map(m => [m[1], m[2] ?? true]));
    for (const match of this._html.matchAll(/<(input|details|button)\b([^>]*)>/gi)) {
      const node = new ElementStub(match[1].toLowerCase());
      node.tagName = match[1].toUpperCase(); node.attrs = attrs(match[2]); node.dataset = Object.fromEntries(Object.entries(node.attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), String(v)]));
      node.type = node.attrs.type || ''; node.name = node.attrs.name || ''; node.value = node.attrs.value || ''; node.checked = Object.hasOwn(node.attrs, 'checked'); node.disabled = Object.hasOwn(node.attrs, 'disabled'); node.open = Object.hasOwn(node.attrs, 'open');
      if (node.tagName === 'INPUT') this.inputNodes.push(node);
      if (node.tagName === 'DETAILS') this.details.push(node);
      if (node.tagName === 'BUTTON') this.actionElements.push(node);
    }
  }
  get innerHTML() { return this._html; }
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
  async fire(type, event = {}) { for (const fn of this.listeners[type] ?? []) await fn(event); }
  append(child) { (this.children ??= []).push(child); }
  setAttribute(name, value) { (this.attrs ??= {})[name] = value; }
  closest() { return this; }
  focus() { globalThis.document.activeElement = this; }
  querySelector(selector) {
    if (selector === 'h1') return {textContent: this._html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ''};
    return null;
  }
  querySelectorAll(selector) { return selector.startsWith('details') ? this.details : []; }
}

const themeModule = (await importAsEsm(resolve(here, 'prototype-theme-preferences.js'))).module;
const expectedIds = ['original', 'after-hours', 'citrus-press', 'blueprint', 'candy-riot'];
assert.deepEqual(themeModule.THEME_OPTIONS.map(item => item.id), expectedIds, 'the catalog has Original plus the four approved themes');
assert.equal(themeModule.THEME_STORAGE_KEY, 'moeazi.monad.prototype.theme.v1', 'theme choice has its own namespaced key');
assert.equal(themeModule.normalizeTheme('unknown'), 'original', 'invalid saved values fall back to Original');
const helperStore = new Map([[themeModule.THEME_STORAGE_KEY, 'blueprint']]);
assert.equal(themeModule.readThemePreference({getItem: key => helperStore.get(key) ?? null}), 'blueprint');
assert.equal(themeModule.readThemePreference({getItem() { throw new Error('blocked'); }}), 'original');
let sessionTheme = '';
assert.equal(themeModule.saveThemePreference('citrus-press', {setItem() { throw new Error('blocked'); }}), 'citrus-press');
sessionTheme = themeModule.saveThemePreference('candy-riot', {setItem(_key, value) { sessionTheme = value; }});
assert.equal(sessionTheme, 'candy-riot', 'storage failure does not prevent a valid current-session choice');

const html = await read('prototype.html');
const inline = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
assert.ok(inline, 'an early theme bootstrap script exists');
assert.ok(html.indexOf('<script>') < html.indexOf('prototype-themes.css'), 'stored theme is applied before palette CSS loads');
assert.match(inline, /moeazi\.monad\.prototype\.theme\.v1/);
for (const id of expectedIds) assert.ok(inline.includes(`'${id}'`), `early allowlist includes ${id}`);
function bootstrap(value, blocked = false) {
  const document = {documentElement: {dataset: {}}};
  vm.runInNewContext(inline, {document, localStorage: {getItem() { if (blocked) throw new Error('blocked'); return value; }}});
  return document.documentElement.dataset.theme;
}
assert.equal(bootstrap('blueprint'), 'blueprint', 'valid theme restores before paint');
assert.equal(bootstrap('made-up'), 'original', 'unknown theme restores as Original');
assert.equal(bootstrap('after-hours', true), 'original', 'blocked reads restore safely as Original');

const settingsModule = (await importAsEsm(resolve(here, 'prototype-screens-secondary.js'))).module;
const model = await import(pathToFileURL(resolve(here, 'prototype-model.mjs')));
const settingsState = model.createState('funded');
const settingsMarkup = settingsModule.renderSettings(settingsState, 'blueprint');
assert.match(settingsMarkup, /<fieldset[^>]*class="theme-picker"[^>]*>/);
assert.match(settingsMarkup, /<legend>Appearance<\/legend>/);
const pickerMarkup = settingsMarkup.match(/<fieldset[^>]*class="theme-picker"[^>]*>[\s\S]*?<\/fieldset>/)?.[0] ?? '';
const radioTags = [...settingsMarkup.matchAll(/<input\b([^>]*)>/g)].map(m => m[1]).filter(attrs => /\bdata-theme-select\b/.test(attrs));
assert.equal(radioTags.length, 5, 'Settings shows exactly five theme choices');
const radios = radioTags.map(attrs => Object.fromEntries([...attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m => [m[1], m[2] ?? true])));
assert.ok(radios.every(radio => radio.type === 'radio' && radio.name === 'moeazi-theme'), 'choices use one native radio group');
assert.deepEqual(radios.map(radio => radio.value), expectedIds);
assert.equal(radios.filter(radio => Object.hasOwn(radio, 'checked')).length, 1, 'exactly one choice is selected');
assert.equal(radios[3].checked, true, 'the selected choice follows the saved theme');
assert.ok(radios.every(radio => !Object.hasOwn(radio, 'tabindex') && !Object.hasOwn(radio, 'aria-hidden')), 'native radios keep browser keyboard and accessibility behavior');
assert.ok(!/role="radio"|aria-checked=/.test(pickerMarkup), 'the picker does not replace native radio semantics with a custom widget');
assert.equal((settingsMarkup.match(/<label class="theme-choice/g) ?? []).length, 5, 'each native radio is wrapped by its readable label');
assert.equal((settingsMarkup.match(/<span class="theme-choice-preview[^>]*aria-hidden="true"/g) ?? []).length, 5, 'decorative swatches are hidden from assistive technology');

const themeCss = await read('prototype-themes.css');
const themedRuleSelectors = [...themeCss.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap(match => match[1].split(',').map(value => value.trim())).filter(selector => selector.includes('[data-theme'));
assert.ok(themedRuleSelectors.length > 10, 'phone palette has explicit theme-scoped rules');
for (const selector of themedRuleSelectors) assert.ok(/(?:^|\s)\.device-shell(?:\b|\[)/.test(selector), `theme selector stays inside the phone shell: ${selector}`);
assert.match(themeCss, /\.theme-choice:has\(input:checked\)/, 'selected swatch responds to live native checked state');
assert.ok(!themeCss.includes(':checked[checked]'), 'selection styling does not depend on the original checked attribute');
const catalog = (await importAsEsm(resolve(here, 'prototype-screens-catalog.js'))).module;
const chartBase = {...model.createState('funded'), selectedMarket: 'BTC-PERP', marketTimeframe: '24H'};
const lineMarkup = catalog.renderMarketDetail({...chartBase, chartStyle: 'line'});
const candleMarkup = catalog.renderMarketDetail({...chartBase, chartStyle: 'candles'});
assert.match(lineMarkup, /class="[^"]*chart-line-path/, 'line chart emits the selector required by themed stroke tokens');
assert.match(candleMarkup, /class="[^"]*chart-candle-up/, 'candle body emits themed direction classes');
assert.match(candleMarkup, /class="[^"]*chart-candle-down/, 'down candles also emit themed direction classes');
assert.match(candleMarkup, /class="[^"]*chart-candle-wick/, 'candle wicks emit the themed axis class');
assert.doesNotMatch(await read('prototype-screens-catalog.js'), /stroke\s*=\s*['"]#[\da-f]{3,8}|fill\s*=\s*['"]#[\da-f]{3,8}/i, 'chart renderer leaves all inline SVG paint to theme tokens');
assert.match(themeCss, /\.chart-candle-up[^{}]*\{[^}]*stroke:var\(--chart-axis\)/, 'candle bodies retain a contrasting theme-controlled outline');
assert.match(themeCss, /\.chart-candle-down[^{}]*\{[^}]*stroke:var\(--chart-axis\)/, 'down candles retain a contrasting theme-controlled outline');
const paintFiles = ['prototype-v2.css', 'prototype-consent.css', 'prototype-inputs.css', 'prototype-marketplace.css', 'prototype-screens-secondary.js'];
for (const file of paintFiles) {
  const source = await read(file);
  assert.doesNotMatch(source, /\b(?:color|background(?:-color)?|border(?:-color)?|fill|stroke)\s*:\s*#[\da-f]{3,8}\b/i, `${file} uses palette roles for app paint`);
}
assert.match(themeCss, /\.device-shell\[data-theme\]\s+:is\(\.hero-balance/, 'themed card textures stay scoped to the phone shell');
assert.match(themeCss, /\.device-shell\[data-theme\]\s+\.chart-line-path/, 'chart styling never themes the neutral reviewer panel');
assert.match(themeCss, /--theme-texture:repeating-linear-gradient|--theme-texture:radial-gradient|--theme-texture:repeating-conic-gradient/, 'accent motifs come from palette tokens and preserve the existing border language');
const receiveMarkup = settingsModule.renderSendReceive({...model.createState('funded'), route: 'receive'});
assert.match(receiveMarkup, /class="demo-qr"[^>]*aria-label="Illustrative QR placeholder, not scannable"/);
assert.match(receiveMarkup, /class="demo-qr-mark"/);

const selectors = ['#app-view', '#tabbar', '#global-status', '#toast', '#sr-live', '#settings-shortcut', '#scenario-select', '#simulation-outcome', '#reviewer-resolve', '.reviewer-panel', '.device-shell'];
const nodes = Object.fromEntries(selectors.map(selector => [selector, new ElementStub(selector)]));
const appState = model.createState('funded');
appState.route = 'settings'; appState.manualTopUpAmount = '37.5'; appState.claimPending = true;
appState.activeOperationId = 'pending-ausd-fixture'; appState.operationOpen = true;
appState.pendingOrder = {kind: 'spot', operationId: 'pending-ausd-fixture', status: 'submitted', amount: '25'};
const stateKey = 'moeazi.monad.prototype-state.v2';
const stateBefore = JSON.stringify(appState);
const storage = new Map([[stateKey, stateBefore], [themeModule.THEME_STORAGE_KEY, 'after-hours']]);
let rejectThemeWrites = false;
globalThis.localStorage = {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { if (rejectThemeWrites && key === themeModule.THEME_STORAGE_KEY) throw new Error('blocked'); storage.set(key, String(value)); },
};
const root = {dataset: {theme: bootstrap('after-hours')}, classList: {contains() { return false; }, toggle() {}}};
const documentStub = {
  activeElement: null, documentElement: root,
  querySelector(selector) { return nodes[selector] ?? null; },
  createElement: () => new ElementStub('option'),
  getElementById(id) { return nodes['#app-view'].inputNodes.find(input => input.attrs.id === id) ?? null; },
};
globalThis.document = documentStub;
globalThis.window = {addEventListener() {}};
globalThis.history = {replaceState() {}, pushState() {}, back() {}};
globalThis.requestAnimationFrame = callback => callback();
globalThis.setTimeout = callback => ({callback});
globalThis.clearTimeout = () => {};
await importAsEsm(resolve(here, 'prototype-app.js'));
const phone = nodes['.device-shell'], appView = nodes['#app-view'];
assert.equal(root.dataset.theme, 'after-hours');
assert.equal(phone.dataset.theme, 'after-hours', 'app initialization mirrors the prepaint choice to the phone shell');
const picker = appView.inputNodes.filter(input => input.dataset.themeSelect !== undefined);
assert.equal(picker.length, 5, 'live Settings render exposes the five approved radio inputs');
const radio = picker.find(input => input.value === 'blueprint');
for (const item of picker) item.checked = item === radio;
documentStub.activeElement = radio;
appView.scrollTop = 91;
const markupBefore = appView.innerHTML;
const savedStateBefore = storage.get(stateKey);
await phone.fire('change', {target: radio});
assert.equal(root.dataset.theme, 'blueprint');
assert.equal(phone.dataset.theme, 'blueprint');
assert.equal(storage.get(themeModule.THEME_STORAGE_KEY), 'blueprint');
assert.equal(storage.get(stateKey), savedStateBefore, 'theme change does not rewrite balances, drafts, or pending operations');
assert.equal(appView.innerHTML, markupBefore, 'theme change does not rerender the active screen');
assert.equal(appView.scrollTop, 91, 'theme change preserves the current scroll position');
assert.equal(documentStub.activeElement, radio, 'theme change keeps keyboard focus on its native radio');

rejectThemeWrites = true;
const fallbackRadio = picker.find(input => input.value === 'candy-riot');
for (const item of picker) item.checked = item === fallbackRadio;
await phone.fire('change', {target: fallbackRadio});
assert.equal(phone.dataset.theme, 'candy-riot', 'blocked storage still applies the session selection');
assert.equal(root.dataset.theme, 'candy-riot');
assert.equal(storage.get(themeModule.THEME_STORAGE_KEY), 'blueprint', 'blocked write does not corrupt the last persisted preference');
assert.equal(storage.get(stateKey), savedStateBefore, 'blocked storage does not make theme choice touch app state');
rejectThemeWrites = false;

await nodes['.reviewer-panel'].fire('click', {target: Object.assign(new ElementStub('button'), {dataset: {action: 'reviewer-reset'}})});
nodes['#scenario-select'].value = 'running';
await nodes['#scenario-select'].fire('change');
assert.equal(phone.dataset.theme, 'candy-riot', 'scenario reset leaves the independent theme preference active');
await phone.fire('click', {target: Object.assign(new ElementStub('button'), {dataset: {action: 'logout'}, disabled: false}), preventDefault() {}});
assert.equal(phone.dataset.theme, 'candy-riot', 'ending the demo session leaves the theme selected');
assert.equal(storage.get(themeModule.THEME_STORAGE_KEY), 'blueprint', 'session selection remains distinct from the last saved theme');

console.log('Theme catalog, native radio semantics, safe prepaint restore, live selection isolation, blocked storage, reset/logout persistence, themed charts, and phone-only paint passed.');
