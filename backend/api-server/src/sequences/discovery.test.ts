import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { discoverFunctions, sourceOfPythonRoute } from "./discovery.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function sourceFiles(root: string, extension: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const result: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(target, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) result.push(target);
  }
  return result;
}

test("checked-in Convex exports and Python endpoints appear in discovery", async () => {
  const expected = new Set<string>();
  const convexRoot = path.join(backendRoot, "convex");
  for (const file of await sourceFiles(convexRoot, ".ts")) {
    if (file.includes(path.sep + "_generated" + path.sep)) continue;
    const module = path.relative(convexRoot, file).replace(/\.ts$/, "").split(path.sep).join("/");
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(internalQuery|internalMutation|internalAction|query|mutation|action)(?:<[^>]+>)?\s*\(/g)) {
      expected.add(`convex:${module}.${match[1]}`);
    }
  }
  const pythonRoot = path.join(backendRoot, "agent-service", "src", "moeazi_agent");
  for (const file of await sourceFiles(pythonRoot, ".py")) {
    const name = path.basename(file);
    const service = name.startsWith("test_center") ? "test-center" : name === "execution_api.py" ? "execution" : "agent";
    for (const item of sourceOfPythonRoute(await readFile(file, "utf8"), service)) expected.add(item.id);
  }
  const actual = new Set((await discoverFunctions()).map((item) => item.id));
  const missing = [...expected].filter((id) => !actual.has(id));
  assert.deepEqual(missing, [], `source inventory omitted ${missing.length} known functions/endpoints`);
  for (const id of ["convex:operatorProgramCatalog.listOwnedPrograms", "convex:operatorProgramCatalog.releaseMobileVersion",
    "agent:POST /v1/providers/platform/model-probe", "execution:POST /internal/dispatch",
    "test-center:POST /internal/test-center/runs", "sidecar:GET /health", "sidecar:POST /internal/uniswap/broadcast"]) {
    assert.ok(actual.has(id), `source inventory must retain the known function or endpoint ${id}`);
  }
});
