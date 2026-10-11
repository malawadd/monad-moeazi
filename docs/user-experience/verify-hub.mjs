import {readdir, readFile, stat} from 'node:fs/promises';
import {basename, dirname, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const hubDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(hubDir, '../..');
const errors = [];
const textExtensions = new Set(['.html', '.css', '.js', '.mjs', '.md']);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const files = await walk(hubDir);
const texts = new Map();
for (const path of files.filter(file => textExtensions.has(extname(file)))) {
  const source = await readFile(path, 'utf8');
  texts.set(path, source);
  const lineCount = source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0);
  if (lineCount > 300) errors.push(`${relative(path)} has ${lineCount} lines (limit 300).`);
}

function relative(path) { return path.slice(hubDir.length + 1).replaceAll('\\', '/'); }
function localTarget(from, raw) {
  const target = raw.trim().replace(/^<|>$/g, '').split(/[?#]/, 1)[0];
  if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return null;
  const path = target.startsWith('/') ? resolve(rootDir, `.${target}`) : resolve(dirname(from), target);
  return path;
}
async function requireTarget(from, raw, kind) {
  const target = localTarget(from, raw);
  if (!target) return;
  try { await stat(target); }
  catch { errors.push(`${relative(from)} has a broken ${kind}: ${raw}`); }
}
async function importHubDataModule(name) {
  const path = resolve(hubDir, name);
  const source = await readFile(path, 'utf8');
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  try { return await import(url); }
  catch (error) {
    const frame = String(error?.stack ?? '').match(/data:text\/javascript;base64,[^:\r\n]*:(\d+):(\d+)/);
    const location = frame ? ` at line ${frame[1]}, column ${frame[2]}` : '';
    const message = String(error?.message ?? error).split(/\r?\n/, 1)[0];
    errors.push(`${name} fails standalone ESM import${location}: ${message}`);
    return null;
  }
}

for (const [path, source] of texts) {
  if (extname(path) === '.md') {
    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      const destination = match[1].trim().split(/\s+/, 1)[0];
      await requireTarget(path, destination, 'Markdown link');
    }
  }
  if (extname(path) === '.html') {
    for (const match of source.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
      await requireTarget(path, match[1], 'HTML asset/link');
    }
  }
  if (extname(path) === '.css') {
    for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      await requireTarget(path, match[1], 'CSS asset');
    }
  }
  if (['.js', '.mjs'].includes(extname(path))) {
    for (const match of source.matchAll(/^\s*import\s+(?:[^'";]*?\s+from\s*)?["']([^"']+)["']/gm)) {
      await requireTarget(path, match[1], 'JavaScript module import');
    }
    for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      await requireTarget(path, match[1], 'JavaScript module import');
    }
  }
}

const rootNavigator = await readFile(resolve(rootDir, 'src/navigation/RootNavigator.tsx'), 'utf8');
const declaredRoutes = new Set([...rootNavigator.matchAll(/<(?:Stack|Tabs)\.Screen\s+name="([^"]+)"/g)].map(match => match[1]));
const audit = await importHubDataModule('audit-data.js');
const research = await importHubDataModule('research-data.js');
if (audit && Array.isArray(audit.routeRows) && Array.isArray(audit.legacyRows) && Array.isArray(audit.frictionRows) && Array.isArray(audit.deepLinkRows)) {
  const auditedRoutes = new Set(audit.routeRows.map(row => row[0] === 'Main · shell' ? 'Main' : row[0]));
  for (const route of declaredRoutes) if (!auditedRoutes.has(route)) errors.push(`Route audit is missing RootNavigator destination “${route}”.`);
  for (const route of auditedRoutes) if (!declaredRoutes.has(route)) errors.push(`Route audit contains unregistered destination “${route}”.`);
  if (declaredRoutes.size !== auditedRoutes.size) errors.push(`Route inventory has ${declaredRoutes.size} destinations, but audit-data.js maps ${auditedRoutes.size}.`);
} else if (audit) errors.push('audit-data.js is missing one or more expected route/legacy/friction/deep-link data arrays.');
if (research && (!Array.isArray(research.sources) || !Array.isArray(research.patterns) || !Array.isArray(research.decisions))) {
  errors.push('research-data.js is missing one or more expected sources/patterns/decisions data arrays.');
}

const screenNames = (await readdir(resolve(rootDir, 'src/screens'))).filter(name => name.endsWith('Screen.tsx'));
const mappedScreens = new Set([
  ...(audit?.routeRows ?? []).map(row => row[1]).filter(name => name.endsWith('Screen.tsx')),
  ...(audit?.legacyRows ?? []).map(row => row[0]),
]);
for (const name of screenNames) if (!mappedScreens.has(name)) errors.push(`Screen audit omits src/screens/${name} from both routes and legacy inventory.`);
for (const name of mappedScreens) if (name.endsWith('Screen.tsx') && !screenNames.includes(name)) errors.push(`Screen audit maps missing source file src/screens/${name}.`);

const prototypeFiles = [...texts].filter(([path]) => /^prototype(?:-[^.]+)?\.(?:html|css|js|mjs)$/.test(basename(path)));
for (const [path, source] of prototypeFiles) {
  if (/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|navigator\.sendBeacon|from\s*["'](?:\.\.\/)*src\/services\//i.test(source)) {
    errors.push(`${relative(path)} contains a live-network primitive or production service import.`);
  }
  if (/\b(?:src|href)\s*=\s*["']https?:\/\//i.test(source) || /@import\s+(?:url\()?\s*["']?https?:\/\//i.test(source)) {
    errors.push(`${relative(path)} loads a remote runtime asset.`);
  }
}

const prototypeCss = texts.get(resolve(hubDir, 'prototype.css')) ?? '';
for (const family of ['Syne', 'Jakarta']) {
  const face = [...prototypeCss.matchAll(/@font-face\s*\{([^}]+)\}/gi)]
    .map(match => match[1]).find(body => new RegExp(`font-family\\s*:\\s*["']?${family}\\b`, 'i').test(body));
  if (!face || !/url\(\s*["']?\.\.?\//i.test(face)) errors.push(`Prototype must load ${family} from a local font file.`);
}

if (errors.length) {
  console.error(`Hub verification found ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Hub verification passed: ${texts.size} text files <=300 lines; ${declaredRoutes.size} routes mapped; local links/assets/imports resolved; prototype has no live service/network hooks; Syne and Jakarta are local.`);
}
