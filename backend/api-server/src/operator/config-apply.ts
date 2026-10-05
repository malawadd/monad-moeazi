import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { applyMonadConvexEnvironment, recreateMonadServices } from "../lifecycle.js";
import { localMonadServiceUrl } from "./local-service.js";
import { CONFIG_READ_ONLY, CONFIG_REGISTRY, CONVEX_CONFIG_KEYS, type ConfigEntry } from "./config-registry.js";

type ApplyDependencies = {
  deployConvex: typeof applyMonadConvexEnvironment;
  recreate: typeof recreateMonadServices;
};

type Preview = { id: string; hash: string; sourceHash: string; expiresAt: number; updates: Record<string, string>;
  errors: string[]; effects: string[]; requiresAcknowledgement: boolean };
const previews = new Map<string, Preview>();
let applying = false;
const expiryMs = 5 * 60_000;

function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function readValues(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}
async function readFileValues(root: string, name: string) {
  const file = path.join(root, name);
  const metadata = await lstat(file);
  if (!metadata.isFile()) throw new Error(`Local configuration ${name} is not a regular file.`);
  return { file, text: await readFile(file, "utf8") };
}
function valueFor(entry: ConfigEntry, agents: Record<string, string>, convex: Record<string, string>, local: Record<string, string> = {}) {
  return entry.file === "local" ? local[entry.key] ?? entry.defaultValue
    : entry.file === "convex" ? convex[entry.key] ?? entry.defaultValue
      : agents[entry.key] ?? convex[entry.key] ?? entry.defaultValue;
}

export async function getConfigState(root = process.cwd()) {
  const agentFile = await readFileValues(root, ".env.agents.monad");
  const convexFile = await readFileValues(root, ".env.convex.monad");
  const localFile = await readFileValues(root, ".env.local");
  const agents = readValues(agentFile.text); const convex = readValues(convexFile.text); const local = readValues(localFile.text);
  let runtimeControls: Record<string, any> | null = null;
  try {
    const secret = process.env.WORKER_SHARED_SECRET;
    if (!secret) throw new Error("No agent credential");
    const agentOrigin = localMonadServiceUrl(process.env.AGENT_API_URL ?? "http://127.0.0.1:9100", 9100, "Agent API");
    const response = await fetch(new URL("/internal/runtime-controls", agentOrigin), {
      headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", signal: AbortSignal.timeout(2200),
    });
    if (response.ok) runtimeControls = await response.json() as Record<string, any>;
  } catch { runtimeControls = null; }
  const effectiveFor = (entry: ConfigEntry): string | null => {
    if (!runtimeControls) return null;
    if (entry.key === "AGENT_DEV_CONTROLS_ENABLED") return String(runtimeControls.enabled === true);
    if (entry.key === "AGENT_MANUAL_GUARD_DEFAULT") return String(runtimeControls.manual_guard === true);
    if (entry.key === "AGENT_LITE_MODE_DEFAULT") return String(runtimeControls.lite_mode === true);
    if (entry.key === "DEV_LITE_ACCOUNT_RUNS_PER_DAY") return String(runtimeControls.limits?.accountRunsPerDay ?? "");
    if (entry.key === "DEV_LITE_GLOBAL_RUNS_PER_DAY") return String(runtimeControls.limits?.globalRunsPerDay ?? "");
    if (entry.key === "DEV_LITE_PROVIDER_BUDGET_USD") return String(runtimeControls.limits?.providerBudgetUsd ?? "");
    return null;
  };
  return { registry: CONFIG_REGISTRY.map((entry) => ({ ...entry,
    currentValue: Object.hasOwn(local, entry.key) ? local[entry.key] : valueFor(entry, agents, convex),
    configuredValue: valueFor(entry, agents, convex, local),
    effectiveValue: effectiveFor(entry),
    runtimeStatus: effectiveFor(entry) === null ? "unavailable / not introspected" : "agent runtime introspection",
    source: entry.file === "local" ? ".env.local (Hono API)"
      : entry.file === "both" ? ".env.agents.monad + local Convex environment"
        : entry.file === "convex" ? "local Convex environment" : ".env.agents.monad",
  })),
  readOnly: Object.entries(CONFIG_READ_ONLY).map(([key, reason]) => ({ key, reason })),
  sourceHash: digest({ local: localFile.text, agents: agentFile.text, convex: convexFile.text }),
  runtimeControls: runtimeControls ? { manualGuard: runtimeControls.manual_guard, liteMode: runtimeControls.lite_mode,
    limits: runtimeControls.limits } : null,
  lastAppliedNote: "Effective values are read from the running agent runtime when its read-only control endpoint is available; other switches remain explicitly unverified." };
}

function normalizedUpdates(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Changes must be an object keyed by reviewed switch name.");
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length || entries.length > CONFIG_REGISTRY.length) throw new Error("Choose one or more reviewed switches.");
  const result: Record<string, string> = {};
  for (const [key, raw] of entries) {
    const entry = CONFIG_REGISTRY.find((item) => item.key === key);
    if (!entry || entry.editable === false || entry.file === "local") throw new Error(`${key} is read-only.`);
    if (typeof raw !== "string" || raw.length > 100 || /[\r\n\0]/.test(raw)) throw new Error(`Invalid value for ${key}.`);
    if (entry.kind === "boolean" && raw !== "true" && raw !== "false") throw new Error(`${key} must be true or false.`);
    if (entry.kind === "choice" && !entry.choices?.includes(raw)) throw new Error(`${key} must use a listed option.`);
    if (entry.kind === "number") {
      const number = Number(raw);
      if (!Number.isFinite(number) || number < (entry.minimum ?? 0) || number > (entry.maximum ?? Number.MAX_SAFE_INTEGER)) {
        throw new Error(`${key} is outside its reviewed range.`);
      }
      result[key] = String(number);
    } else result[key] = raw;
  }
  return result;
}

function preflight(updates: Record<string, string>, agents: Record<string, string>, convex: Record<string, string>) {
  const candidate = { ...agents, ...convex, ...updates };
  const errors: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === "AGENT_MANUAL_GUARD_DEFAULT" && value !== "true") {
      errors.push("Manual Guard must remain enabled in this local stack.");
    }
    if (key === "AGENT_DEV_CONTROLS_ENABLED" && value !== "true") {
      errors.push("Development controls cannot be disabled through this console because their cross-service shutdown path is not verified.");
    }
    if (key === "MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED" && value === "true") {
      errors.push("Managed-program enrollment can affect customer accounts and cannot be enabled by the operator workspace.");
    }
    if (key === "BYOK_SECRET_BACKEND" && value === "aws_kms"
        && (!candidate.BYOK_AWS_KMS_KEY_ID || !candidate.BYOK_AWS_REGION)) {
      errors.push("AWS KMS storage requires a configured local key ID and region before this backend can be selected.");
    }
    if (key === "DEEPSEEK_THINKING_ENABLED" && value === "true"
        && (candidate.AGENT_MANUAL_GUARD_DEFAULT !== "true" || candidate.AGENT_LITE_MODE_DEFAULT !== "true"
          || Number(candidate.DEV_LITE_PROVIDER_BUDGET_USD) <= 0)) {
      errors.push("Thinking mode requires Manual Guard, Lite Mode, and a positive provider budget to remain enabled.");
    }
    if (value !== "true") continue;
    if (["LIVE_EXECUTION_ENABLED", "MAINNET_VENUE_SETUP_ENABLED", "MOBILE_WALLET_WITHDRAWALS_ENABLED",
      "MOBILE_PURCHASES_ENABLED", "MOBILE_FUNDING_QUOTES_ENABLED", "MOBILE_SPONSORSHIP_ENABLED",
      "MANAGED_VAULT_PROVISION_ENABLED", "MANAGED_VAULT_EXECUTION_ENABLED", "MANAGED_VAULT_STOP_ENABLED",
      "SCOPED_UNISWAP_EXECUTION_ENABLED", "UNISWAP_HOOK_EXPERIMENT_ENABLED"].includes(key)) {
      errors.push(`${key} cannot be enabled from this console because its existing authority/certification readiness check cannot be verified locally.`);
    }
    if (key === "TEST_CENTER_EXTERNAL_NETWORK_ENABLED") errors.push("External Test Center network access is not supported by this local console.");
    if (key === "MAINNET_VENUE_SETUP_ENABLED" && (!candidate.CERTIFIED_VENUES || candidate.DEPENDENCY_SAFETY_MODE !== "enforce")) {
      errors.push("Mainnet venue setup needs existing certified-venue evidence and dependency safety enforcement.");
    }
    if (key === "MOBILE_SPONSORSHIP_ENABLED" && candidate.MOBILE_SPONSORSHIP_CERTIFIED !== "true") {
      errors.push("Sponsorship cannot be enabled without existing certification evidence.");
    }
    if (key === "AGENT_TEST_CENTER_ENABLED") {
      const sha = candidate.TEST_CENTER_REPOSITORY_SHA ?? "";
      const identities = (candidate.TEST_CENTER_OPERATOR_SUBJECTS ?? "").split(",").map((item) => item.trim()).sort();
      const requiredIdentities = ["moeazi:fixture:manual-sequence", "moeazi:operator:local"].sort();
      if (!/^[a-f0-9]{40}$/.test(sha) || candidate.MAINNET_VENUE_SETUP_ENABLED === "true"
          || candidate.LIVE_EXECUTION_ENABLED === "true" || candidate.CERTIFIED_VENUES
          || candidate.ENVIRONMENT !== "local" || candidate.TEST_CENTER_ENVIRONMENT !== "local"
          || candidate.TEST_CENTER_EXTERNAL_NETWORK_ENABLED === "true"
          || identities.length !== requiredIdentities.length || identities.some((item, index) => item !== requiredIdentities[index])) {
        errors.push("Test Center needs a frozen repository SHA, local loopback setup, exactly the operator plus isolated fixture subjects, and all live/network gates closed with no certified venues.");
      }
    }
    if (key === "MANAGED_VAULT_EXECUTION_ENABLED" && (candidate.LIVE_EXECUTION_ENABLED !== "true"
        || candidate.MAINNET_VENUE_SETUP_ENABLED !== "true" || candidate.DEPENDENCY_SAFETY_MODE !== "enforce"
        || !candidate.CERTIFIED_VENUES?.split(",").some((venue) => venue.trim().toLowerCase() === "uniswap"))) {
      errors.push("Managed vault execution requires the existing live gate, enforced dependency checks, and Uniswap certification evidence.");
    }
    if (key === "SCOPED_UNISWAP_EXECUTION_ENABLED" && (candidate.LIVE_EXECUTION_ENABLED !== "true"
        || candidate.MOBILE_SPONSORSHIP_CERTIFIED !== "true")) {
      errors.push("Scoped Uniswap requires the existing live gate and sponsorship certification evidence.");
    }
    if (key === "UNISWAP_HOOK_EXPERIMENT_ENABLED" && !candidate.CERTIFIED_VENUES?.split(",").some((venue) => venue.trim().toLowerCase() === "uniswap")) {
      errors.push("The hook experiment requires existing Uniswap certification evidence.");
    }
  }
  if (candidate.LIVE_EXECUTION_ENABLED === "true" && candidate.DEPENDENCY_SAFETY_MODE !== "enforce") {
    errors.push("Live execution requires dependency safety mode to be enforce.");
  }
  if (candidate.AGENT_TEST_CENTER_ENABLED === "true" && candidate.TEST_CENTER_EXTERNAL_NETWORK_ENABLED === "true") {
    errors.push("Test Center external network access must stay disabled.");
  }
  const accountRuns = Number(candidate.DEV_LITE_ACCOUNT_RUNS_PER_DAY);
  const globalRuns = Number(candidate.DEV_LITE_GLOBAL_RUNS_PER_DAY);
  if (Number.isFinite(accountRuns) && Number.isFinite(globalRuns) && globalRuns < accountRuns) {
    errors.push("Lite Mode global runs per day must be at least the per-account limit.");
  }
  if (candidate.AGENT_LITE_MODE_DEFAULT === "false" && candidate.AGENT_MANUAL_GUARD_DEFAULT !== "true") {
    errors.push("Lite Mode may be disabled only while Manual Guard stays enabled.");
  }
  if (candidate.DEPENDENCY_SAFETY_MODE === "observe" && ["LIVE_EXECUTION_ENABLED", "MANAGED_VAULT_EXECUTION_ENABLED"]
      .some((key) => candidate[key] === "true")) {
    errors.push("Execution gates cannot remain open while dependency safety mode is observe.");
  }
  return errors;
}

export async function previewConfig(value: unknown, root = process.cwd()) {
  const updates = normalizedUpdates(value);
  const [state, agentFile, convexFile] = await Promise.all([
    getConfigState(root), readFileValues(root, ".env.agents.monad"), readFileValues(root, ".env.convex.monad"),
  ]);
  const agents = readValues(agentFile.text); const convex = readValues(convexFile.text);
  const errors = preflight(updates, agents, convex);
  const entries = Object.keys(updates).map((key) => CONFIG_REGISTRY.find((item) => item.key === key)!);
  const effects = entries.map((entry) => `${entry.key}: ${entry.impact} Restart/deploy: ${entry.services.filter((name) => name !== "convex").join(", ") || "Convex deployment only"}.`);
  const requiresAcknowledgement = entries.some((entry) => entry.safetyGate || updates[entry.key] === "true"
    && /execution|venue|withdraw|purchase|sponsor|vault|Uniswap/i.test(entry.label)
    || (entry.key === "AGENT_LITE_MODE_DEFAULT" && updates[entry.key] === "false"));
  const id = randomUUID();
  const sourceHash = state.sourceHash;
  const hash = digest({ id, updates, sourceHash, errors, effects, requiresAcknowledgement });
  const preview = { previewId: id, hash, changes: entries.map((entry) => ({ key: entry.key,
    from: valueFor(entry, agents, convex), to: updates[entry.key] })), effects, errors, requiresAcknowledgement };
  previews.set(id, { id, hash, sourceHash, expiresAt: Date.now() + expiryMs, updates, errors, effects, requiresAcknowledgement });
  for (const [key, item] of previews) if (item.expiresAt <= Date.now()) previews.delete(key);
  return preview;
}

function updateEnvText(text: string, updates: Record<string, string>) {
  const rows = text.split(/\r?\n/); const newline = text.includes("\r\n") ? "\r\n" : "\n";
  for (const [key, value] of Object.entries(updates)) {
    const hits = rows.map((row, index) => row.startsWith(`${key}=`) ? index : -1).filter((index) => index >= 0);
    if (hits.length > 1) throw new Error(`Duplicate ${key} entries need manual repair.`);
    const line = `${key}=${value}`;
    if (hits.length) rows[hits[0]] = line;
    else rows.splice(rows.at(-1) === "" ? rows.length - 1 : rows.length, 0, line);
  }
  return rows.join(newline) + (text.endsWith("\n") ? "" : newline);
}

async function writeAtomic(file: string, text: string) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { const handle = await open(temp, "wx", 0o600); try { await handle.writeFile(text, "utf8"); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, file);
  } catch (error) { try { await unlink(temp); } catch { /* temp may not exist */ } throw error; }
}

export async function applyConfig(value: unknown, root = process.cwd(), dependencies: ApplyDependencies = {
  deployConvex: applyMonadConvexEnvironment, recreate: recreateMonadServices,
}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Apply needs a preview confirmation.");
  const input = value as Record<string, unknown>;
  const preview = previews.get(String(input.previewId));
  if (!preview || preview.expiresAt < Date.now() || input.hash !== preview.hash) throw new Error("Configuration preview expired or changed. Preview it again.");
  if (preview.errors.length) throw new Error(`Preflight blocked apply: ${preview.errors.join(" ")}`);
  if (preview.requiresAcknowledgement && input.acknowledgement !== "APPLY REVIEWED CONFIGURATION") throw new Error("Type APPLY REVIEWED CONFIGURATION to confirm this configuration change.");
  if (applying) throw new Error("Another configuration apply is running.");
  const agentFile = await readFileValues(root, ".env.agents.monad");
  const convexFile = await readFileValues(root, ".env.convex.monad");
  const localFile = await readFileValues(root, ".env.local");
  const currentHash = digest({ local: localFile.text, agents: agentFile.text, convex: convexFile.text });
  if (currentHash !== preview.sourceHash) throw new Error("Local configuration changed after preview. Refresh and preview again.");
  applying = true; previews.delete(preview.id);
  const localValues = readValues(localFile.text);
  const localUpdates = Object.fromEntries(Object.entries(preview.updates).filter(([key]) => Object.hasOwn(localValues, key)));
  const agentUpdates = Object.fromEntries(Object.entries(preview.updates).filter(([key]) =>
    CONFIG_REGISTRY.find((entry) => entry.key === key)?.file !== "convex"));
  const convexUpdates = Object.fromEntries(Object.entries(preview.updates).filter(([key]) => CONVEX_CONFIG_KEYS.has(key)));
  const previousConvex = readValues(convexFile.text);
  const restartServices = [...new Set(Object.keys(agentUpdates).flatMap((key) =>
    CONFIG_REGISTRY.find((entry) => entry.key === key)?.services ?? []).filter((name) => name !== "convex"))];
  let changedLocal = false; let changedAgent = false; let changedConvex = false;
  try {
    if (Object.keys(localUpdates).length) { await writeAtomic(localFile.file, updateEnvText(localFile.text, localUpdates)); changedLocal = true; }
    if (Object.keys(agentUpdates).length) { await writeAtomic(agentFile.file, updateEnvText(agentFile.text, agentUpdates)); changedAgent = true; }
    if (Object.keys(convexUpdates).length) { await writeAtomic(convexFile.file, updateEnvText(convexFile.text, convexUpdates)); changedConvex = true; }
    if (Object.keys(convexUpdates).length) await dependencies.deployConvex(convexUpdates, root);
    const composeResult = restartServices.length ? await dependencies.recreate(restartServices, root) : { recreated: [], pending: [] };
    const pending = composeResult.pending;
    return { applied: true, changes: preview.updates, effects: preview.effects,
      restarted: composeResult.recreated, pending, effectiveValue: null,
      runtimeStatus: pending.length ? "pending_restart" : "unverified" };
  } catch (error) {
    let rollbackOk = true;
    try {
      if (changedLocal) await writeAtomic(localFile.file, localFile.text);
      if (changedAgent) await writeAtomic(agentFile.file, agentFile.text);
      if (changedConvex) await writeAtomic(convexFile.file, convexFile.text);
      if (Object.keys(convexUpdates).length) {
        const restore = Object.fromEntries(Object.keys(convexUpdates).map((key) => [key,
          previousConvex[key] ?? CONFIG_REGISTRY.find((entry) => entry.key === key)!.defaultValue]));
        await dependencies.deployConvex(restore, root);
      }
      if (restartServices.length) await dependencies.recreate(restartServices, root);
    } catch { rollbackOk = false; }
    throw new Error(rollbackOk
      ? `Configuration apply failed and prior values were restored: ${error instanceof Error ? error.message : "validation failed"}`
      : "Configuration apply failed and rollback could not be fully verified. Inspect the local Monad service logs before retrying.");
  } finally { applying = false; }
}
