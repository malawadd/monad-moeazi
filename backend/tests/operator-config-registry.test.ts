import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { CONFIG_READ_ONLY, CONFIG_REGISTRY } from "../api-server/src/operator/config-registry.js";

const switchName = /(?:_ENABLED|_DEFAULT|_MODE|_BUDGET(?:_USD)?|_RUNS_PER_DAY|_STARTER_CREDITS|_CREDITS|_CERTIFIED|_DETERMINISTIC|_ENVIRONMENT|_SUBJECTS|_RETENTION_DAYS|_MAX_USDC_UNITS|_LIMIT_WEI)$/;
const roots = ["agent-service/src/moeazi_agent", "execution-sidecar/src", "convex", "api-server/src",
  "app/api/mobile"];

async function filesUnder(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === "_generated" ? [] : [filesUnder(file)];
      return /\.(?:py|ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [Promise.resolve([file])] : [];
    }))).flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function addMatches(target: Set<string>, source: string, expression: RegExp) {
  for (const match of source.matchAll(expression)) if (switchName.test(match[1])) target.add(match[1]);
}

test("registry covers active Compose, Python, sidecar, Convex, and mobile route switches", async () => {
  const root = process.cwd(); const names = new Set<string>();
  const compose = await readFile(path.resolve(root, "docker-compose.agents.yml"), "utf8");
  const setup = await readFile(path.resolve(root, "scripts/setup-monad-local.mjs"), "utf8");
  const mobileEnv = await readFile(path.resolve(root, "execution-sidecar/mobile-integrations.env.example"), "utf8");
  addMatches(names, compose, /\$\{([A-Z][A-Z0-9_]*)(?::[^}]*)?\}/g);
  addMatches(names, setup, /^\s{2,}([A-Z][A-Z0-9_]+):/gm);
  addMatches(names, setup, /preserved\("([A-Z][A-Z0-9_]+)"/g);
  addMatches(names, mobileEnv, /^([A-Z][A-Z0-9_]+)=/gm);

  const activeFiles = (await Promise.all(roots.map((item) => filesUnder(path.resolve(root, item)))))
    .flat().filter((file) => !file.includes(`${path.sep}api-server${path.sep}src${path.sep}operator${path.sep}`)
      && !file.includes(`${path.sep}api-server${path.sep}src${path.sep}sequences${path.sep}`));
  const sources = await Promise.all(activeFiles.map(async (file) => ({ file, source: await readFile(file, "utf8") })));
  for (const { file, source } of sources) {
    if (file.endsWith(`${path.sep}config.py`)) {
      for (const match of source.matchAll(/^\s{4}([a-z][a-z0-9_]+)\s*:/gm)) {
        const name = match[1].toUpperCase(); if (switchName.test(name)) names.add(name);
      }
    }
    addMatches(names, source, /(?:process\.env|this\.env|env)\.([A-Z][A-Z0-9_]*)/g);
    addMatches(names, source, /(?:env|this\.env)\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g);
    addMatches(names, source, /(?:getenv|environ\.get)\(\s*["']([A-Z][A-Z0-9_]*)["']/g);
  }

  const covered = new Set([...CONFIG_REGISTRY.map((item) => item.key), ...Object.keys(CONFIG_READ_ONLY)]);
  const missing = [...names].filter((name) => !covered.has(name));
  assert.deepEqual(missing, [], `Configuration switch inventory is incomplete: ${missing.join(", ")}`);
  for (const entry of CONFIG_REGISTRY) {
    assert.ok(setup.includes(`${entry.key}:`), `Setup must retain ${entry.key} across reruns/rotation.`);
    if (entry.editable !== false) assert.ok(setup.includes(`preserved("${entry.key}"`), `Setup must preserve editable ${entry.key}.`);
  }
  for (const key of Object.keys(CONFIG_READ_ONLY)) {
    assert.equal(CONFIG_REGISTRY.find((entry) => entry.key === key)?.editable, false, `${key} must be visibly read-only.`);
  }
});
