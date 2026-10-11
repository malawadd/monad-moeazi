import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const base = await readFile(resolve(here, 'prototype-v2.css'), 'utf8');
const roles = await readFile(resolve(here, 'prototype-themes.css'), 'utf8');
const ids = ['original', 'after-hours', 'citrus-press', 'blueprint', 'candy-riot'];
function declarations(text) {
  return Object.fromEntries([...text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)\s*;/g)].map(match => [match[1], match[2].trim()]));
}
function block(text, expression) { return text.match(expression)?.[1] ?? ''; }
function color(name, vars, seen = new Set()) {
  assert.ok(!seen.has(name), `no variable cycle at ${name}`); seen.add(name);
  let value = vars[name]; assert.ok(value, `theme has ${name}`);
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  if (reference) return color(reference[1], vars, seen);
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  assert.ok(hex, `${name} resolves to a solid hex color (got ${value})`);
  let digits = hex[1]; if (digits.length === 3) digits = [...digits].map(char => char + char).join('');
  return [0, 2, 4].map(index => parseInt(digits.slice(index, index + 2), 16) / 255);
}
function luminance(rgb) {
  const channels = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}
function ratio(foreground, background, vars) {
  const values = [luminance(color(foreground, vars)), luminance(color(background, vars))].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
function themeVars(id) {
  const baseVars = declarations(block(base, /:root\s*\{([^}]*)\}/));
  const roleVars = declarations(block(roles, /:root\s*\{([^}]*)\}/));
  const themeBlock = id === 'original' ? '' : block(roles, new RegExp(`html\\[data-theme="${id}"\\]\\s*\\.device-shell[^\\{]*\\{([^}]*)\\}`));
  return {...baseVars, ...roleVars, ...declarations(themeBlock)};
}
// WCAG 2.2 SC 1.4.11 evaluates essential graphical boundaries against adjacent
// colors; G209 permits a contrasting separator to define a shape. These are
// actual app usages, not every possible pairing of theme tokens:
// https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
// https://www.w3.org/WAI/WCAG22/Techniques/general/G209
const textPairs = [
  ['--ink', '--paper'], ['--ink', '--cream'], ['--ink', '--surface-white'], ['--ink', '--surface-inset'],
  ['--ink', '--surface-success'], ['--ink', '--surface-wait'], ['--ink', '--surface-warning'],
  ['--ink', '--surface-pink'], ['--ink', '--surface-sky'], ['--ink', '--surface-mint'], ['--ink', '--surface-lilac'],
  ['--text-secondary', '--surface-pink'], ['--text-secondary', '--surface-sky'], ['--text-secondary', '--surface-mint'],
  ['--text-secondary', '--surface-lilac'], ['--text-secondary', '--surface-warning'],
  ['--text-muted', '--paper'], ['--text-muted', '--cream'], ['--text-muted', '--surface-white'],
  ['--text-muted', '--surface-inset'], ['--text-muted', '--surface-wait'], ['--text-muted', '--surface-warning'],
  ['--text-muted', '--surface-success'], ['--text-muted', '--surface-pink'], ['--text-muted', '--surface-sky'],
  ['--text-muted', '--surface-mint'], ['--text-muted', '--surface-lilac'], ['--text-subtle', '--paper'],
  ['--muted', '--paper'], ['--muted', '--cream'], ['--muted', '--surface-wait'], ['--muted', '--surface-neutral'],
  ['--link', '--paper'], ['--error-ink', '--surface-warning'], ['--text-toast', '--surface-toast'],
  ['--on-accent', '--butter'], ['--on-pink', '--pink'], ['--on-sky', '--sky'], ['--on-mint', '--mint'], ['--on-orange', '--orange'],
];
const graphicPairs = [
  ['--border', '--paper'], ['--border', '--cream'], ['--border', '--surface-white'], ['--border', '--surface-inset'],
  ['--chart-line', '--paper'], ['--chart-axis', '--paper'],
  ['--status-success', '--surface-success-pill'],
];
const failures = [];
for (const id of ids) {
  const vars = themeVars(id);
  for (const [foreground, background] of textPairs) {
    const value = ratio(foreground, background, vars);
    if (value < 4.5) failures.push(`${id}: text ${foreground} on ${background} = ${value.toFixed(2)}:1 (needs 4.5:1)`);
  }
  for (const [foreground, background] of graphicPairs) {
    const value = ratio(foreground, background, vars);
    if (value < 3) failures.push(`${id}: essential graphic ${foreground} on ${background} = ${value.toFixed(2)}:1 (needs 3:1)`);
  }
  // Accent controls keep a dark outline when it contrasts, but the accent fill
  // itself also separates the component from the surrounding phone surface.
  for (const accent of ['--butter', '--pink', '--sky', '--mint', '--orange']) {
    const border = ratio('--accent-border', '--paper', vars);
    const fill = ratio(accent, '--paper', vars);
    if (Math.max(border, fill) < 3) failures.push(`${id}: ${accent} control boundary against --paper = max(border ${border.toFixed(2)}, fill ${fill.toFixed(2)}) < 3:1`);
  }
  // The focus treatment has a ring and a halo. Only one layer needs to stand
  // out from the adjacent surface; requiring each layer separately overstates
  // SC 1.4.11 for this paired indicator.
  for (const background of ['--paper', '--surface-warning']) {
    const ring = ratio('--focus-ring', background, vars);
    const halo = ratio('--focus-halo', background, vars);
    if (Math.max(ring, halo) < 3) failures.push(`${id}: focus indicator against ${background} = max(${ring.toFixed(2)}, ${halo.toFixed(2)}) < 3:1`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  assert.fail(`${failures.length} theme contrast pairs need review`);
}
console.log(`Theme contrast passed: ${ids.length} palettes, ${textPairs.length} actual-use text pairs (4.5:1), ${graphicPairs.length} graphic pairs, five accent-boundary alternatives, and two layered focus contexts (3:1).`);
