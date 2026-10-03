import { discoverFunctions } from "./discovery.js";
import { canonicalJson, sha256 } from "./canonical.js";
import type { FunctionDescriptor, JsonSchema } from "./types.js";

export const CATALOG_VERSION = "manual-sequences-v1";
export const FIXTURE_SUBJECT = "moeazi:fixture:manual-sequence";

const emptyObject: JsonSchema = { type: "object", properties: {}, additionalProperties: false };
const string = (description: string, minLength = 1, maxLength = 200): JsonSchema =>
  ({ type: "string", description, minLength, maxLength });
const reviewed = (input: Omit<FunctionDescriptor, "version" | "reviewed" | "runnable" | "requiredAuthority">):
  FunctionDescriptor => ({ ...input, requiredAuthority: authorityFor(input.source), version: 1, reviewed: true, runnable: true });

function authorityFor(source: FunctionDescriptor["source"]) {
  if (source === "convex") return "Server-signed JWT for the fixed, walletless moeazi:operator:local subject. No owner signature is provided or required for these reviewed operator-owned calls.";
  if (source === "test-center") return "Fixed isolated fixture subject plus server-held Test Center service credential; no wallet or owner signature.";
  if (source === "agent") return "Fixed operator context and server-held worker credential; this reviewed local endpoint does not receive browser credentials.";
  return "Loopback service authority only; no browser credential, wallet key, or owner signature.";
}

const reviews: FunctionDescriptor[] = [
  reviewed({ id: "convex:operatorProgramCatalog.listOwnedPrograms", title: "List operator programs",
    source: "convex", kind: "query", target: { module: "operatorProgramCatalog", name: "listOwnedPrograms" },
    argumentSchema: emptyObject, identityModes: ["operator"], effectDescription: "Reads programs owned by the dedicated local operator strategy account.",
    possibleEffects: ["Reads local Convex program and version records."],
    cost: { class: "none", description: "No provider call or external request." }, safety: "read_only", mutation: false }),
  reviewed({ id: "convex:agentTeamMutations.create", title: "Create a paused operator team",
    source: "convex", kind: "mutation", target: { module: "agentTeamMutations", name: "create" },
    argumentSchema: { type: "object", properties: {
      name: string("Name for a team in the dedicated local operator workspace.", 2, 60),
      tier: { type: "string", enum: ["focus", "pro", "max"], description: "Team intelligence tier." },
    }, required: ["name", "tier"], additionalProperties: false },
    identityModes: ["operator"], effectDescription: "Creates a paused, unfunded agent team and its initial saved version in the operator workspace.",
    possibleEffects: ["Writes local Convex team and version records.", "Does not start an analysis or change a customer assignment."],
    cost: { class: "none", description: "No provider call; analysis is not started." }, safety: "local_fixture", mutation: true }),
  reviewed({ id: "convex:agentTeamMutations.duplicate", title: "Duplicate an owned operator team",
    source: "convex", kind: "mutation", target: { module: "agentTeamMutations", name: "duplicate" },
    argumentSchema: { type: "object", properties: {
      teamId: string("Existing team ID; Convex checks that it belongs to this operator account.", 3, 128),
      name: string("Name for the new paused copy.", 2, 60),
    }, required: ["teamId", "name"], additionalProperties: false },
    identityModes: ["operator"], effectDescription: "Duplicates an operator-owned team as a new paused, unfunded team.",
    possibleEffects: ["Writes local Convex team and version records.", "Convex rejects IDs outside the operator workspace."],
    cost: { class: "none", description: "No provider call; analysis is not started." }, safety: "local_fixture", mutation: true }),
  reviewed({ id: "convex:agentTeamQueries.detail", title: "Read an owned operator team",
    source: "convex", kind: "query", target: { module: "agentTeamQueries", name: "detail" },
    argumentSchema: { type: "object", properties: {
      teamId: string("Existing team ID; Convex returns details only for this operator account.", 3, 128),
    }, required: ["teamId"], additionalProperties: false }, identityModes: ["operator"],
    effectDescription: "Reads an operator-owned team and its saved versions, drafts, and local run records.",
    possibleEffects: ["Reads local Convex records.", "Convex returns no team for an ID outside the operator workspace."],
    cost: { class: "none", description: "No provider call." }, safety: "read_only", mutation: false }),
  reviewed({ id: "agent:GET /health", title: "Read agent service health", source: "agent", kind: "http",
    target: { method: "GET", path: "/health" }, argumentSchema: emptyObject, identityModes: ["operator"],
    effectDescription: "Reads the local agent service health and effective runtime safety status.",
    possibleEffects: ["Returns local runtime status only."], cost: { class: "none", description: "No provider call." },
    safety: "read_only", mutation: false }),
  reviewed({ id: "agent:GET /v1/routing/markets", title: "List available routing markets",
    source: "agent", kind: "http", target: { method: "GET", path: "/v1/routing/markets" },
    argumentSchema: emptyObject, identityModes: ["operator"],
    effectDescription: "Reads the routing market catalog from the agent service.",
    possibleEffects: ["Reads local routing configuration."], cost: { class: "none", description: "No provider call." },
    safety: "read_only", mutation: false }),
  reviewed({ id: "agent:GET /v1/tiers/{tier}", title: "Read tier limits", source: "agent", kind: "http",
    target: { method: "GET", path: "/v1/tiers/{tier}" }, argumentSchema: { type: "object", properties: {
      tier: { type: "string", enum: ["focus", "pro", "max"] },
    }, required: ["tier"], additionalProperties: false }, identityModes: ["operator"],
    effectDescription: "Reads the configured limits for one analysis tier.",
    possibleEffects: ["Reads local tier configuration."], cost: { class: "none", description: "No provider call." },
    safety: "read_only", mutation: false }),
  reviewed({ id: "execution:GET /health", title: "Read execution gateway health", source: "execution",
    kind: "http", target: { method: "GET", path: "/health" }, argumentSchema: emptyObject,
    identityModes: ["operator"], effectDescription: "Reads execution adapter health; it cannot submit or sign a transaction.",
    possibleEffects: ["Reads local adapter readiness."], cost: { class: "none", description: "No provider call." },
    safety: "read_only", mutation: false }),
  reviewed({ id: "sidecar:GET /health", title: "Read execution sidecar health", source: "sidecar",
    kind: "http", target: { method: "GET", path: "/health" }, argumentSchema: emptyObject,
    identityModes: ["operator"], effectDescription: "Reads execution sidecar configuration and readiness.",
    possibleEffects: ["Reads local sidecar readiness."], cost: { class: "none", description: "No provider call." },
    safety: "read_only", mutation: false }),
  reviewed({ id: "test-center:GET /registry", title: "Read Test Center catalog",
    source: "test-center", kind: "http", target: { method: "GET", path: "/registry" },
    argumentSchema: emptyObject, identityModes: ["fixture"],
    effectDescription: "Reads the isolated Test Center's checked-in fixture registry.",
    possibleEffects: ["Reads Test Center fixture metadata only."],
    cost: { class: "none", description: "No provider or workflow call." }, safety: "local_fixture", mutation: false }),
  reviewed({ id: "test-center:POST /internal/test-center/runs", title: "Run a checked-in Test Center fixture",
    source: "test-center", kind: "http", target: { method: "POST", path: "/internal/test-center/runs" },
    argumentSchema: { type: "object", properties: {
      feature_id: string("Checked-in Test Center feature identifier.", 2, 80),
      scenario_id: string("Checked-in deterministic fixture identifier.", 2, 160),
      control_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      request_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      idempotency_key: string("Caller-supplied key preserved for the single attempt.", 8, 128),
      prerequisite_run_ids: { type: "object", additionalProperties: { type: "string" } },
    }, required: ["feature_id", "scenario_id", "control_hash", "request_hash", "idempotency_key"],
    additionalProperties: false }, identityModes: ["fixture"],
    effectDescription: "Evaluates a checked-in isolated Test Center fixture and persists its local receipt.",
    possibleEffects: ["Writes an append-only fixture result in local Timescale.", "Does not call a provider, signer, wallet, venue, Temporal workflow, or customer product state."],
    cost: { class: "none", description: "Fixture-only compute; no provider cost." },
    safety: "local_fixture", mutation: true, idempotencyArgument: "idempotency_key" }),
  reviewed({ id: "test-center:GET /internal/test-center/runs/{run_id}", title: "Read a Test Center fixture run",
    source: "test-center", kind: "http", target: { method: "GET", path: "/internal/test-center/runs/{run_id}" },
    argumentSchema: { type: "object", properties: { run_id: string("Previously recorded fixture run ID.", 1, 160) },
      required: ["run_id"], additionalProperties: false }, identityModes: ["fixture"],
    effectDescription: "Reads a previously recorded isolated Test Center run.",
    possibleEffects: ["Reads local fixture history only."], cost: { class: "none", description: "No provider call." },
    safety: "read_only", mutation: false }),
];

const highImpact = new Set(["paid", "funded", "live"]);
const knownById = new Map(reviews.map((item) => [item.id, item]));

function testCenterGate(environment: NodeJS.ProcessEnv) {
  if (environment.AGENT_TEST_CENTER_ENABLED !== "true") return "The optional Test Center is disabled.";
  const allowlist = (environment.TEST_CENTER_OPERATOR_SUBJECTS ?? "").split(",").map((item) => item.trim());
  if (!allowlist.includes(FIXTURE_SUBJECT)) return "The synthetic fixture identity is not explicitly allowlisted.";
  const endpoint = environment.TEST_CENTER_API_URL || "http://127.0.0.1:9110";
  try {
    if (!["127.0.0.1", "localhost", "::1"].includes(new URL(endpoint).hostname)) {
      return "The Test Center endpoint is not loopback.";
    }
  } catch { return "TEST_CENTER_API_URL is invalid."; }
  return undefined;
}

export async function getFunctionCatalog(environment = process.env) {
  const discovered = await discoverFunctions();
  const values = new Map<string, FunctionDescriptor>();
  for (const item of discovered) {
    const safe = knownById.get(item.id);
    values.set(item.id, safe ? { ...safe } : item);
  }
  for (const item of reviews) if (!values.has(item.id)) values.set(item.id, {
    ...item, runnable: false, blockedReason: "The reviewed target was not found in current source or service discovery.",
  });

  const testCenterBlock = testCenterGate(environment);
  for (const [id, item] of values) {
    if (item.source !== "test-center" || !item.reviewed) continue;
    if (testCenterBlock) values.set(id, { ...item, runnable: false, blockedReason: testCenterBlock });
  }
  const functions = [...values.values()].sort((a, b) => a.id.localeCompare(b.id));
  const revision = sha256(canonicalJson(functions)).slice(0, 12);
  return { catalogVersion: CATALOG_VERSION + "+" + revision, functions };
}

export function requiresExplicitAcknowledgement(items: FunctionDescriptor[]) {
  return items.some((item) => highImpact.has(item.safety));
}

export const reviewedFunctions = reviews;
