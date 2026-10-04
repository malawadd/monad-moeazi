import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(process.cwd());
const inventoryPath = resolve(root,
  "agent-service/src/moeazi_agent/evidence_lifecycle_sink_inventory.json");

function strictJson(source, label) {
  let at = 0;
  const skip = () => { while (/\s/.test(source[at] ?? "")) at += 1; };
  const string = () => {
    const start = at++;
    while (at < source.length) {
      if (source[at] === "\\") at += 2;
      else if (source[at++] === '"') return JSON.parse(source.slice(start, at));
    }
    throw new Error(`Malformed JSON string in ${label}`);
  };
  const value = () => {
    skip();
    if (source[at] === "{") return object();
    if (source[at] === "[") {
      at += 1; skip();
      if (source[at] === "]") { at += 1; return; }
      while (true) {
        value(); skip();
        if (source[at] === "]") { at += 1; return; }
        if (source[at++] !== ",") throw new Error(`Malformed JSON array in ${label}`);
      }
    }
    if (source[at] === '"') { string(); return; }
    const start = at;
    while (at < source.length && !/[,\]}\s]/.test(source[at])) at += 1;
    if (start === at) throw new Error(`Malformed JSON value in ${label}`);
  };
  const object = () => {
    at += 1; skip();
    const keys = new Set();
    if (source[at] === "}") { at += 1; return; }
    while (true) {
      if (source[at] !== '"') throw new Error(`Malformed JSON object in ${label}`);
      const key = string();
      if (keys.has(key)) throw new Error(`Duplicate JSON object key ${key} in ${label}`);
      keys.add(key); skip();
      if (source[at++] !== ":") throw new Error(`Malformed JSON object in ${label}`);
      value(); skip();
      if (source[at] === "}") { at += 1; return; }
      if (source[at++] !== ",") throw new Error(`Malformed JSON object in ${label}`);
      skip();
    }
  };
  value(); skip();
  if (at !== source.length) throw new Error(`Malformed trailing JSON in ${label}`);
  return JSON.parse(source);
}

function unique(items, identity, label) {
  const values = items.map(identity);
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate ${label} in evidence sink inventory`);
  }
}

export function loadInventory(path = inventoryPath) {
  const inventory = strictJson(readFileSync(path, "utf8"), path);
  const expected = ["evidence_lifecycle_provider_callsites.json",
    "evidence_lifecycle_provider_callsites_02.json"];
  const keys = ["providerCallsiteFiles", "pythonGroups", "pythonRoot", "schemaVersion",
    "sinks", "typescriptGroups", "typescriptRoots"];
  if (Object.keys(inventory).sort().join() !== keys.join()
    || inventory.schemaVersion !== 5
    || JSON.stringify(inventory.providerCallsiteFiles) !== JSON.stringify(expected)) {
    throw new Error("Evidence sink inventory v5 parts are invalid");
  }
  const actualParts = readdirSync(resolve(path, ".."))
    .filter((name) => /^evidence_lifecycle_provider_callsites.*\.json$/.test(name)).sort();
  if (JSON.stringify(actualParts) !== JSON.stringify(expected)) {
    throw new Error("Evidence sink inventory v5 part closure is invalid");
  }
  const providerCallsites = [];
  for (const filename of expected) {
    const partPath = resolve(path, "..", filename);
    const part = strictJson(readFileSync(partPath, "utf8"), partPath);
    if (part.schemaVersion !== 1 || !Array.isArray(part.providerCallsites)
      || Object.keys(part).sort().join() !== "providerCallsites,schemaVersion") {
      throw new Error("Evidence provider callsite inventory part is invalid");
    }
    providerCallsites.push(...part.providerCallsites);
  }
  const { providerCallsiteFiles: _parts, ...manifest } = inventory;
  unique(manifest.sinks, (item) => item.id, "sink ID");
  unique(manifest.pythonGroups, (item) => item.kind, "Python group");
  unique(manifest.typescriptGroups, (item) => item.kind, "TypeScript group");
  unique(providerCallsites, (item) => JSON.stringify(Object.entries(item).sort()),
    "logical provider entry");
  unique(providerCallsites, (item) => item.fingerprint, "provider fingerprint");
  return { ...manifest, providerCallsites };
}

function filesBelow(directory) {
  const result = [];
  for (const name of readdirSync(directory).sort()) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) result.push(...filesBelow(path));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) result.push(path);
  }
  return result;
}

function callName(node) {
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text;
  return ts.isIdentifier(node.expression) ? node.expression.text : "unknown";
}

function functionName(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current))
      && current.parent && ts.isVariableDeclaration(current.parent)
      && ts.isIdentifier(current.parent.name)) return current.parent.name.text;
    if (ts.isMethodDeclaration(current) && current.name) return current.name.getText();
    current = current.parent;
  }
  return "<module>";
}

function kindFor(path, name) {
  if (path.startsWith("convex/") && ["insert", "patch", "replace", "delete"].includes(name)) {
    return "convex_write";
  }
  if (path.startsWith("convex/") && name === "runMutation") return "convex_mutation_boundary";
  const lifecycleRoute = path.startsWith("app/api/")
    && (path.includes("agent-monitoring") || path.includes("agent-test-center"));
  if (lifecycleRoute && ["fetch", "json", "Response", "StreamingResponse"].includes(name)) {
    return "lifecycle_next_output";
  }
  return null;
}

export function discoverTypeScriptSource(sourceText, path) {
  const calls = [];
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const identities = new Map();
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = callName(node);
      const kind = kindFor(path, callee);
      if (kind) {
        const fn = functionName(node);
        const normalized = node.getText(source).replace(/\s+/g, " ").trim();
        const identity = `${fn}:${kind}:${callee}:${normalized}`;
        const ordinal = (identities.get(identity) ?? 0) + 1;
        identities.set(identity, ordinal);
        const body = `${path}:${identity}:${ordinal}`;
        calls.push({ path, function: fn, kind, callee, ordinal,
          fingerprint: createHash("sha256").update(body).digest("hex") });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return calls;
}

export function discoverTypeScript() {
  const paths = [...filesBelow(resolve(root, "convex")), ...filesBelow(resolve(root, "app/api"))];
  return paths.flatMap((absolute) => {
    const path = relative(root, absolute).replaceAll("\\", "/");
    return discoverTypeScriptSource(readFileSync(absolute, "utf8"), path);
  });
}

export function assertTypeScriptCoverage(calls, manifest) {
  if (Array.isArray(manifest)) {
    const groups = new Map();
    for (const call of calls) groups.set(call.kind, [...(groups.get(call.kind) ?? []), call]);
    if ([...groups.keys()].sort().join() !== manifest.map((item) => item.kind).sort().join()) {
      throw new Error("TypeScript sink boundary groups drifted");
    }
    for (const item of manifest) {
      const group = groups.get(item.kind);
      const rootHash = createHash("sha256").update(group.map((call) => call.fingerprint)
        .sort().join("\n")).digest("hex");
      const required = ["owner", "dataClass", "boundary", "policyRoute"];
      if (required.some((key) => !item[key]) || group.length !== item.count
        || rootHash !== item.fingerprintRoot) throw new Error(`Drift in ${item.kind}`);
    }
    return;
  }
  const actual = new Map();
  for (const call of calls) actual.set(call.fingerprint,
    (actual.get(call.fingerprint) ?? 0) + 1);
  const expected = new Map(Object.entries(manifest).map(([key, value]) =>
    [key, Number(value.count)]));
  const missing = [...expected].filter(([key, count]) => actual.get(key) !== count);
  const unreviewed = [...actual].filter(([key, count]) => expected.get(key) !== count);
  if (missing.length || unreviewed.length) {
    throw new Error(`TypeScript sink discovery mismatch; missing=${JSON.stringify(missing)}; `
      + `unreviewed=${JSON.stringify(unreviewed)}`);
  }
  const required = ["owner", "dataClass", "boundary", "policyRoute"];
  for (const [fingerprint, item] of Object.entries(manifest)) {
    if (required.some((key) => !item[key])) throw new Error(`Incomplete sink ${fingerprint}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const inventory = loadInventory();
  const calls = discoverTypeScript();
  assertTypeScriptCoverage(calls, inventory.typescriptGroups);
  console.log(`evidence-sink-inventory ${calls.length} TypeScript calls`);
}
