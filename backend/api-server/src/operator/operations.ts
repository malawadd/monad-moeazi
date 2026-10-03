import { randomUUID } from "node:crypto";
import { anyApi } from "convex/server";
import { platformModels } from "../../../lib/modelProviders.js";
import { LOCAL_OPERATOR_SUBJECT } from "../../../lib/operatorIdentity.js";
import { operatorConvex } from "./convex.js";
import { localMonadServiceUrl } from "./local-service.js";

const ref = (module: string, name: string) => (anyApi as any)[module][name];
const simPaths: Record<string, string> = {
  bootstrapAccount: "accounts/bootstrap", listObservations: "observations/catalog", submitRun: "runs",
  prepareRun: "runs/prepare", registerDataset: "runs/dataset", requestEntry: "runs/request-entry",
  readRun: "runs/read", controlRun: "runs/control", readPortfolio: "runs/portfolio", readOutcome: "runs/outcome",
};

export class OperatorOperationError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

async function agent(path: string, method = "GET", body?: unknown, timeout = 10_000) {
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) throw new OperatorOperationError("Agent runtime credential is unavailable.", 503);
  let base: URL;
  try { base = new URL(localMonadServiceUrl(process.env.AGENT_API_URL ?? "http://127.0.0.1:9100", 9100, "Agent API")); }
  catch { throw new OperatorOperationError("Operator agent access is limited to the exact local Monad service port.", 503); }
  const response = await fetch(new URL(path, base), { method, cache: "no-store", signal: AbortSignal.timeout(timeout),
    headers: { Authorization: `Bearer ${secret}`, Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({ error: "Agent runtime returned invalid JSON." }));
  if (!response.ok) throw new OperatorOperationError(data.detail ?? data.error ?? "Agent runtime request failed.", response.status);
  return data;
}

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OperatorOperationError("Payload must be a JSON object.", 400);
  return value as Record<string, any>;
}

async function candidate(payload: Record<string, any>) {
  if (typeof payload.baseVersionId !== "string" || !Array.isArray(payload.choices) || payload.choices.length < 2 || payload.choices.length > 32) {
    throw new OperatorOperationError("Invalid mobile model choices.", 400);
  }
  const choices = [];
  const prices = new Map<string, any>();
  for (const item of payload.choices) {
    if (!item || typeof item.slot !== "string" || typeof item.model !== "string"
        || !["openai", "deepseek", "openrouter"].includes(item.provider)) throw new OperatorOperationError("Invalid mobile model choice.", 400);
    if (item.provider === "openrouter") {
      if (!prices.has(item.model)) prices.set(item.model, await agent("/v1/providers/platform/model-qualification", "POST", { model: item.model }));
      const price = prices.get(item.model);
      choices.push({ ...item, pricing: { input: price.maximumInputPriceMicrousdPerMillion,
        cachedInput: price.cachedInputPriceMicrousdPerMillion, output: price.maximumOutputPriceMicrousdPerMillion } });
    } else choices.push(item);
  }
  return (await operatorConvex()).mutation(ref("operatorProgramCatalog", "createMobileModelCandidate"), {
    baseVersionId: payload.baseVersionId, choices,
  });
}

async function release(payload: Record<string, any>) {
  if (Object.keys(payload).join(",") !== "programVersionId" || typeof payload.programVersionId !== "string") {
    throw new OperatorOperationError("Choose one frozen program version.", 400);
  }
  const convex = await operatorConvex();
  const catalog = await convex.query(ref("operatorProgramCatalog", "listOwnedPrograms"), {});
  const program = catalog.programs.find((row: any) => row.versions.some((version: any) => version.programVersionId === payload.programVersionId));
  const version = program?.versions.find((row: any) => row.programVersionId === payload.programVersionId);
  if (!version || program.ownership !== "moeazi_mobile") throw new OperatorOperationError("Select a visible frozen mobile version.", 409);
  if (program.releasedVersionId === payload.programVersionId) return { releasedVersionId: payload.programVersionId, duplicate: true };
  const providers = (await agent("/v1/providers/platform/status")).providers ?? {};
  const missing = version.model.routes.filter((route: any) => !providers[route.provider]?.credentialLoaded).map((route: any) => route.provider);
  if (missing.length) throw new OperatorOperationError(`Agent runtime has no loaded ${[...new Set(missing)].join(", ")} key.`, 409);
  const models = [...new Set(version.model.routes.filter((route: any) => route.provider === "openrouter").map((route: any) => route.model))];
  let maximumProbeCost = 0;
  for (const model of models) {
    const details = await agent("/v1/providers/platform/model-qualification", "POST", { model });
    maximumProbeCost += Math.ceil((details.maximumInputPriceMicrousdPerMillion * 2500
      + details.maximumOutputPriceMicrousdPerMillion * 128) / 1_000_000);
  }
  if (maximumProbeCost > 20_000) throw new OperatorOperationError("OpenRouter compatibility checks exceed the $0.02 release cap. Choose cheaper models.", 409);
  for (const model of models) await agent("/v1/providers/platform/model-probe", "POST", { model }, 60_000);
  return convex.mutation(ref("operatorProgramCatalog", "releaseMobileVersion"), { programVersionId: payload.programVersionId });
}

async function simulation(operation: string, payload: unknown) {
  const path = simPaths[operation];
  if (!path) throw new OperatorOperationError("Simulation operation is not allowlisted.", 404);
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) throw new OperatorOperationError("Simulation backend is unavailable.", 503);
  let base: URL;
  try { base = new URL(localMonadServiceUrl(process.env.AGENT_API_URL ?? "http://127.0.0.1:9100", 9100, "Agent API")); }
  catch { throw new OperatorOperationError("Simulation access is limited to the exact local Monad service port.", 503); }
  const convex = await operatorConvex();
  const workspace = await convex.query(ref("operatorLocalBootstrap", "workspace"), {});
  const specs = await convex.query(ref("programExperiments", "listExperimentSpecs"), {});
  assertOwnedSimulationReferences(payload, {
    userId: String(workspace.account?.userId ?? ""),
    strategyAccountId: String(workspace.account?.strategyAccountId ?? ""),
    experimentSpecIds: new Set((specs as any[]).map((item) => String(item._id))),
  });
  const response = await fetch(new URL(`/v1/simulation/${path}`, base), {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Accept: "application/json",
      "X-Moeazi-Subject": LOCAL_OPERATOR_SUBJECT, "X-Request-Id": randomUUID() },
    body: JSON.stringify(payload ?? {}),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: "Simulation backend returned invalid JSON." }; }
  if (!response.ok) throw new OperatorOperationError(data.detail ?? data.error ?? "Simulation request failed.", response.status);
  return data;
}

export function assertOwnedSimulationReferences(value: unknown, owner: {
  userId: string; strategyAccountId: string; experimentSpecIds: Set<string>;
}) {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    for (const [key, nested] of Object.entries(item)) {
      if (typeof nested === "string") {
        const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
        if (["experimentspecid", "scopeid", "controllerid"].includes(normalized)
            && !owner.experimentSpecIds.has(nested)) {
          throw new OperatorOperationError("Simulation calls may use only an experiment spec owned by the local operator.", 403);
        }
        if (normalized === "strategyaccountid" && nested !== owner.strategyAccountId) {
          throw new OperatorOperationError("Simulation calls may use only the local operator strategy account.", 403);
        }
        if (normalized === "userid" && nested !== owner.userId) {
          throw new OperatorOperationError("Simulation calls may not select another user.", 403);
        }
      }
      if (nested && typeof nested === "object") pending.push(nested);
    }
  }
}

export async function runOperation(value: unknown) {
  const input = object(value);
  if (Object.keys(input).some((key) => !["operation", "payload"].includes(key)) || typeof input.operation !== "string") {
    throw new OperatorOperationError("Only an allowlisted operation and payload are accepted.", 400);
  }
  const operation = input.operation; const payload = object(input.payload ?? {}); const convex = await operatorConvex();
  const pending = [input.payload];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    for (const [key, nested] of Object.entries(item)) {
      if (key.toLowerCase().replace(/[^a-z]/g, "").includes("subject")) {
        throw new OperatorOperationError("Identity is derived from the fixed local operator session.", 400);
      }
      if (nested && typeof nested === "object") pending.push(nested);
    }
  }
  switch (operation) {
    case "listPrograms": return convex.query(ref("operatorProgramCatalog", "listOwnedPrograms"), {});
    case "platformProviders": {
      const status = await agent("/v1/providers/platform/status");
      return { ...status, models: Object.fromEntries(Object.entries(platformModels).map(([name, items]) =>
        [name, items.filter((model: any) => model.pricingKnown).map((model: any) => model.id)])) };
    }
    case "readLiteMode": return agent("/internal/runtime-controls");
    case "setLiteMode": {
      if (typeof payload.liteMode !== "boolean" || !Number.isSafeInteger(payload.expectedVersion)) throw new OperatorOperationError("Expected Lite Mode state and current version.", 400);
      return agent("/internal/runtime-controls", "PATCH", { lite_mode: payload.liteMode, expected_version: payload.expectedVersion,
        confirmation: payload.liteMode ? undefined : "DISABLE SAFEGUARD", updated_by: "local-operator-console" });
    }
    case "lookupTestCredits": {
      if (payload.action === "lookup" && typeof payload.identifier === "string") return convex.query(ref("operatorTestCredits", "lookup"), { identifier: payload.identifier });
      throw new OperatorOperationError("Invalid credit lookup.", 400);
    }
    case "grantTestCredits": {
      if (payload.action !== "grant" || typeof payload.userId !== "string" || !Number.isSafeInteger(payload.amount)
          || payload.amount <= 0 || typeof payload.requestId !== "string") throw new OperatorOperationError("Invalid credit grant.", 400);
      return convex.mutation(ref("operatorTestCredits", "grant"), { userId: payload.userId,
        expectedEmail: typeof payload.expectedEmail === "string" ? payload.expectedEmail : undefined,
        amount: payload.amount, requestId: payload.requestId });
    }
    case "readCreditCharging": return convex.query(ref("operatorCreditControls", "read"), {});
    case "setCreditCharging": {
      if (typeof payload.chargingEnabled !== "boolean" || !Number.isSafeInteger(payload.expectedVersion)) throw new OperatorOperationError("Invalid credit control update.", 400);
      return convex.mutation(ref("operatorCreditControls", "set"), { chargingEnabled: payload.chargingEnabled, expectedVersion: payload.expectedVersion });
    }
    case "createMobileModelCandidate": return candidate(payload);
    case "releaseMobileVersion": return release(payload);
    case "listSpecs": return { specs: await convex.query(ref("programExperiments", "listExperimentSpecs"), {}) };
    case "freezeSpec": {
      if (!(["customer_team", "managed_program"].includes(payload.controllerKind) && typeof payload.controllerVersionId === "string"
          && typeof payload.idempotencyKey === "string" && typeof payload.specJson === "string")) throw new OperatorOperationError("Invalid experiment specification.", 422);
      return convex.mutation(ref("programExperiments", "freezeExperimentSpec"), payload);
    }
    default: if (simPaths[operation]) return simulation(operation, input.payload); break;
  }
  throw new OperatorOperationError("Operator API operation is not allowlisted.", 404);
}
