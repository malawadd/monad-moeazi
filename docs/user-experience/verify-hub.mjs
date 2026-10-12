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

const rootPath = resolve(rootDir, 'src/navigation/RootNavigator.tsx');
const tabsPath = resolve(rootDir, 'src/navigation/UserModeTabs.tsx');
const linksPath = resolve(rootDir, 'src/navigation/presentationRoutes.ts');
const rootNavigator = await readFile(rootPath, 'utf8');
const tabsSource = await readFile(tabsPath, 'utf8');
const linksSource = await readFile(linksPath, 'utf8');
const audit = await importHubDataModule('audit-data.js');
const research = await importHubDataModule('research-data.js');
const migration = await importHubDataModule('migration-inventory.js');
if (audit && Array.isArray(audit.routeRows) && Array.isArray(audit.legacyRows) && Array.isArray(audit.frictionRows) && Array.isArray(audit.deepLinkRows)) {
  const historicalRoutes = audit.routeRows.map(row => row[0] === 'Main · shell' ? 'Main' : row[0]);
  if (new Set(historicalRoutes).size !== historicalRoutes.length) errors.push('Historical route audit contains duplicate destinations.');
} else if (audit) errors.push('audit-data.js is missing one or more expected route/legacy/friction/deep-link data arrays.');
if (research && (!Array.isArray(research.sources) || !Array.isArray(research.patterns) || !Array.isArray(research.decisions))) {
  errors.push('research-data.js is missing one or more expected sources/patterns/decisions data arrays.');
}

function stringsInSet(source, name) {
  const body = source.match(new RegExp(`const ${name}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\);`))?.[1] ?? '';
  return new Set([...body.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]));
}
function stringsInArray(source, name) {
  const body = source.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`))?.[1] ?? '';
  return new Set([...body.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]));
}
function components(expression) {
  const conditional = expression.match(/userMode\s*\?\s*([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)/);
  if (conditional) return {user: conditional[1], developer: conditional[2]};
  const single = expression.trim().match(/^([A-Za-z_$][\w$]*)$/);
  return single ? {user: single[1], developer: single[1]} : null;
}
function bindings(source, expression, label) {
  const result = new Map();
  for (const match of source.matchAll(expression)) {
    const route = match[1];
    const screens = components(match[2]);
    if (!screens) errors.push(`${label} route “${route}” uses unsupported binding ${match[2]}.`);
    if (result.has(route)) errors.push(`${label} declares duplicate route “${route}”.`);
    result.set(route, screens ?? {});
  }
  return result;
}
function imports(source, fromPath) {
  const result = new Map();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const item of match[1].split(',')) {
      const names = item.trim().match(/^(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?$/);
      if (!names) continue;
      const target = resolve(dirname(fromPath), match[2]);
      result.set(names[2] ?? names[1], target + (extname(target) ? '' : '.tsx'));
    }
  }
  return result;
}
function compareAccess(actual, expected, label) {
  const got = ['user', 'developer'].filter(mode => actual.modes?.includes(mode));
  const want = ['user', 'developer'].filter(mode => expected.modes?.includes(mode));
  if (got.join(',') !== want.join(',')) errors.push(`${label} access is [${got.join(', ')}], inventory expects [${want.join(', ')}].`);
  for (const mode of want) if (actual[mode] !== expected[mode]) errors.push(`${label} ${mode} component is ${actual[mode] ?? 'missing'}, expected ${expected[mode]}.`);
}

if (migration?.stackBindings && migration?.tabBindings && migration?.modeBranchScreens && migration?.migrationScreenRows) {
  const rootImports = imports(rootNavigator, rootPath);
  const tabImports = imports(tabsSource, tabsPath);
  const rootStatic = bindings(rootNavigator, /<Stack\.Screen\s+name="([^"]+)"\s+component=\{([^}]+)\}/g, 'RootNavigator');
  const start = rootNavigator.indexOf('const screens: Array<[string, React.ComponentType<any>]> = [');
  const end = start < 0 ? -1 : rootNavigator.indexOf('];', start);
  const list = start >= 0 && end >= 0
    ? rootNavigator.slice(start, end + 2).replace('const screens: Array<[string, React.ComponentType<any>]> = [', '') : '';
  if (!list) errors.push('RootNavigator data-driven route array could not be resolved.');
  const rootDynamic = bindings(list, /\['([^']+)',\s*([^\]]+)\]/g, 'RootNavigator data-driven');
  const rootRoutes = new Map([...rootStatic, ...rootDynamic]);
  const inventoryRoutes = new Map(migration.stackBindings.map(row => [row.route, row]));
  if (inventoryRoutes.size !== migration.stackBindings.length) errors.push('Migration stack inventory has duplicate route names.');
  for (const name of rootRoutes.keys()) if (!inventoryRoutes.has(name)) errors.push(`Current RootNavigator route “${name}” is absent from migration-inventory.js.`);
  const both = stringsInSet(linksSource, 'BOTH_MODE_ROUTES');
  const userOnly = stringsInSet(linksSource, 'USER_ONLY_ROUTES');
  const developerOnly = stringsInSet(linksSource, 'DEVELOPER_ONLY_ROUTES');
  for (const [name, expected] of inventoryRoutes) {
    const actual = rootRoutes.get(name);
    if (!actual) { errors.push(`Inventory route “${name}” is not registered in RootNavigator.`); continue; }
    const modes = name === 'Welcome' || name === 'Main' ? ['user', 'developer']
      : ['user', 'developer'].filter(mode => (mode === 'user' ? userOnly.has(name) || both.has(name) : developerOnly.has(name) || both.has(name)));
    compareAccess({...actual, modes}, expected, `RootNavigator.${name}`);
    for (const mode of expected.modes) {
      const component = expected[mode];
      if (component === 'PresentationTabs') continue;
      const source = rootImports.get(component);
      if (!source) errors.push(`RootNavigator component “${component}” has no import.`);
      else if (basename(source) !== `${component}.tsx`) errors.push(`RootNavigator component “${component}” resolves to ${basename(source)}.`);
    }
  }
  if (!rootNavigator.includes('screens.filter(([name]) => canAccessRoute(presentation.presentationMode, name))')) errors.push('RootNavigator data-driven routes bypass canAccessRoute.');
  for (const name of rootDynamic.keys()) if (Number(both.has(name)) + Number(userOnly.has(name)) + Number(developerOnly.has(name)) !== 1) {
    errors.push(`presentationRoutes.ts must assign “${name}” to exactly one route access set.`);
  }
  for (const [setName, routes] of [['BOTH_MODE_ROUTES', both], ['USER_ONLY_ROUTES', userOnly], ['DEVELOPER_ONLY_ROUTES', developerOnly]]) {
    for (const name of routes) if (!rootRoutes.has(name)) errors.push(`${setName} contains unregistered route “${name}”.`);
  }

  const actualTabs = bindings(tabsSource, /<Tabs\.Screen\s+name="([^"]+)"\s+component=\{([^}]+)\}/g, 'UserModeTabs');
  const inventoryTabs = new Map(migration.tabBindings.map(row => [row.route, row]));
  if (inventoryTabs.size !== migration.tabBindings.length) errors.push('Migration tab inventory has duplicate names.');
  for (const name of actualTabs.keys()) if (!inventoryTabs.has(name)) errors.push(`Current tab “${name}” is absent from migration-inventory.js.`);
  for (const [name, expected] of inventoryTabs) {
    const actual = actualTabs.get(name);
    if (!actual) { errors.push(`Inventory tab “${name}” is missing from UserModeTabs.`); continue; }
    const modes = name === 'Account' ? ['developer'] : ['user', 'developer'];
    compareAccess({...actual, modes}, expected, `UserModeTabs.${name}`);
    for (const mode of expected.modes) {
      const source = tabImports.get(expected[mode]);
      if (!source) errors.push(`UserModeTabs component “${expected[mode]}” has no import.`);
      else if (basename(source) !== `${expected[mode]}.tsx`) errors.push(`UserModeTabs component “${expected[mode]}” resolves to ${basename(source)}.`);
    }
  }
  if (!/\{\s*userMode\s*\?\s*null\s*:\s*<Tabs\.Screen\s+name="Account"/.test(tabsSource)) errors.push('Account tab is no longer Developer-only.');
  for (const [setName, mode] of [['USER_TAB_NAMES', 'user'], ['DEVELOPER_TAB_NAMES', 'developer']]) {
    const actual = stringsInArray(linksSource, setName);
    const expected = migration.tabBindings.filter(row => row.modes.includes(mode)).map(row => row.route);
    if (actual.size !== expected.length || expected.some(name => !actual.has(name))) errors.push(`${setName} differs from migration-inventory.js.`);
  }
  for (const branch of migration.modeBranchScreens) {
    const path = resolve(rootDir, 'src/screens', branch.host);
    const source = await readFile(path, 'utf8').catch(() => '');
    if (!source.includes(`import {${branch.component}}`) || !source.includes(`from './${branch.file.replace(/\.tsx$/, '')}'`)
      || !source.includes(`presentationMode === 'user' ? <${branch.component} />`)) errors.push(`${branch.host} is missing its inventoried User-mode branch ${branch.component}.`);
  }
} else if (migration) errors.push('migration-inventory.js is missing required route, tab, branch, or screen inventories.');

const screenNames = (await readdir(resolve(rootDir, 'src/screens'))).filter(name => name.endsWith('Screen.tsx'));
const mappedScreens = new Set([
  ...(audit?.routeRows ?? []).map(row => row[1]).filter(name => name.endsWith('Screen.tsx')),
  ...(audit?.legacyRows ?? []).map(row => row[0]),
  ...(migration?.migrationScreenRows ?? []).map(row => row[0]),
  ...(migration?.modeBranchScreens ?? []).map(row => row.file),
]);
for (const name of screenNames) if (!mappedScreens.has(name)) errors.push(`Screen audit omits src/screens/${name} from historical, migration, or mode-branch inventory.`);
for (const name of mappedScreens) if (name.endsWith('Screen.tsx') && !screenNames.includes(name)) errors.push(`Screen inventory maps missing source file src/screens/${name}.`);

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
  console.log(`Hub verification passed: ${texts.size} text files <=300 lines; historical audit ${audit.routeRows.length} destinations; current inventory ${migration.stackBindings.length} stack bindings + ${migration.tabBindings.length} mode-aware tabs; local links/assets/imports resolved; prototype has no live service/network hooks; Syne and Jakarta are local.`);
}
