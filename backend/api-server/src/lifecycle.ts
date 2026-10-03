import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadMonadEnvironment } from "./environment.js";

const execFileAsync = promisify(execFile);
const composeServices = new Set([
  "timescaledb", "redis", "redis-scoped-replica", "migrations", "temporal", "convex",
  "convex-dashboard", "api", "test-center", "worker", "evaluation-worker", "dispatcher",
  "ingestors", "execution-gateway", "execution-sidecar",
]);
const recreatableServices = new Set([...composeServices].filter((name) => name !== "migrations"));
const convexConfigKeys = new Set([
  "AGENT_DEV_CONTROLS_ENABLED", "DEV_STARTER_CREDITS", "MAINNET_VENUE_SETUP_ENABLED",
  "LIVE_EXECUTION_ENABLED", "MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED",
  "MOBILE_WALLET_WITHDRAWALS_ENABLED", "BYOK_ENABLED",
]);

function distinctAllowed(names: string[], allowed: Set<string>, purpose: string): string[] {
  const distinct = [...new Set(names)];
  if (!distinct.length || distinct.some((name) => !allowed.has(name))) {
    throw new Error(`${purpose} requires one or more explicitly allowlisted targets.`);
  }
  return distinct;
}

async function dockerCompose(args: string[], root: string, description: string): Promise<string> {
  try {
    const result = await execFileAsync("docker", [
      "compose", "-p", "moeazi-monad", "--env-file", ".env.agents.monad",
      "-f", "docker-compose.agents.yml", ...args,
    ], { cwd: path.resolve(root), timeout: 120_000, maxBuffer: 1_000_000 });
    return result.stdout;
  } catch {
    throw new Error(`Scoped Monad ${description} failed.`);
  }
}

export async function restartMonadServices(names: string[], root = process.cwd()): Promise<void> {
  const services = distinctAllowed(names, composeServices, "Restart");
  await dockerCompose(["restart", ...services], root, "service restart");
}

export async function recreateMonadServices(
  names: string[],
  root = process.cwd(),
): Promise<{ recreated: string[]; pending: string[] }> {
  const services = distinctAllowed(names, recreatableServices, "Recreate");
  const running: string[] = [];
  const pending: string[] = [];
  for (const service of services) {
    const container = await dockerCompose(["ps", "--status", "running", "-q", service], root, "running-service check");
    (container.trim() ? running : pending).push(service);
  }
  if (running.length) {
    await dockerCompose(["up", "-d", "--no-deps", "--force-recreate", ...running], root, "service recreate");
  }
  return { recreated: running, pending };
}

export async function startMonadService(name: string, root = process.cwd()): Promise<void> {
  if (name !== "test-center") throw new Error("Only the optional local Test Center may be started from the operator console.");
  await dockerCompose(["up", "-d", "--no-deps", name], root, "optional Test Center start");
}

function parseEnv(text: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    entries[match[1]] = value;
  }
  return entries;
}

function validateConvexValue(name: string, value: string): void {
  const validBoolean = value === "true" || value === "false";
  const validCredits = name === "DEV_STARTER_CREDITS" && /^(0|[1-9][0-9]*)$/.test(value);
  if (!value || /[\r\n\0]/.test(value) || (!validBoolean && !validCredits)) {
    throw new Error(`Invalid value for local Convex setting ${name}.`);
  }
}

async function runConvex(args: string[], root: string): Promise<void> {
  const cli = path.join(root, "node_modules", "convex", "bin", "main.js");
  const tmpDir = path.join(root, ".data", "convex-tmp");
  await mkdir(tmpDir, { recursive: true });
  try {
    await execFileAsync(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, CONVEX_TMPDIR: tmpDir },
      timeout: 180_000,
      maxBuffer: 1_000_000,
    });
  } catch {
    throw new Error("Local Convex environment apply failed; restore the prior values and retry.");
  }
}

export async function applyMonadConvexEnvironment(
  updates: Record<string, string>,
  root = process.cwd(),
): Promise<void> {
  const names = Object.keys(updates);
  if (!names.length || names.some((name) => !convexConfigKeys.has(name))) {
    throw new Error("Convex environment apply accepts only reviewed local settings.");
  }
  for (const [name, value] of Object.entries(updates)) validateConvexValue(name, value);

  await loadMonadEnvironment(root);
  const convexUrl = process.env.CONVEX_SELF_HOSTED_URL;
  const adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY;
  if (!adminKey || !convexUrl) throw new Error("Local Convex credentials are unavailable to the API host.");
  const parsedUrl = new URL(convexUrl);
  if (parsedUrl.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsedUrl.hostname) || parsedUrl.port !== "3310") {
    throw new Error("Convex environment apply is limited to the local Monad deployment on port 3310.");
  }
  const convexFile = path.join(root, ".env.convex.monad");
  const currentValues = parseEnv(await readFile(convexFile, "utf8"));
  for (const [name, value] of Object.entries(updates)) {
    if (!(name in currentValues)) throw new Error(`Local Convex setting ${name} is not present in the deployment allowlist.`);
    await runConvex(["env", "set", name, value], root);
  }
  await runConvex(["dev", "--once"], root);
}
