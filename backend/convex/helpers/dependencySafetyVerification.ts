const MATRIX_VERSION = "dependency-safety-v2";

const ALLOWED_BINDINGS: Record<string, readonly string[]> = {
  propose: ["analysis_decision_hash", "market", "policy_version", "venue"],
  request_approval: ["analysis_decision_hash", "market", "policy_version", "venue"],
  simulate: ["account", "analysis_id", "market", "quote_reference", "venue"],
};

function normalize(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Safety request numbers must be finite.");
    return Number.isInteger(value) ? Math.trunc(value) : value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, normalize(child)]));
  }
  return value;
}

function canonical(value: unknown) {
  return JSON.stringify(normalize(value));
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function canonicalDecimal(value: number) {
  if (!Number.isFinite(value)) throw new Error("Safety request numbers must be finite.");
  if (Object.is(value, -0) || value === 0) return "0";
  const source = value.toString().toLowerCase();
  if (!source.includes("e")) return source;
  const [coefficient, rawExponent] = source.split("e");
  const exponent = Number(rawExponent);
  const negative = coefficient.startsWith("-");
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const dot = unsigned.indexOf(".");
  const digits = unsigned.replace(".", "");
  const point = (dot < 0 ? digits.length : dot) + exponent;
  let body: string;
  if (point <= 0) body = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) body = `${digits}${"0".repeat(point - digits.length)}`;
  else body = `${digits.slice(0, point)}.${digits.slice(point)}`;
  if (body.includes(".")) body = body.replace(/0+$/, "").replace(/\.$/, "");
  return `${negative ? "-" : ""}${body}`;
}

export function canonicalRequestValue(value: unknown): unknown {
  if (value === null) return ["null"];
  if (typeof value === "boolean") return ["boolean", value ? "true" : "false"];
  if (typeof value === "number") return ["number", canonicalDecimal(value)];
  if (typeof value === "string") return ["string", value];
  if (Array.isArray(value)) return ["array", value.map(canonicalRequestValue)];
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonicalRequestValue(child)]);
    return ["object", entries];
  }
  throw new Error(`Unsupported safety request value: ${typeof value}.`);
}

async function requestSha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalRequestValue(value)));
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(result)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

export async function canonicalTaggedHash(value: unknown) {
  return await requestSha256(value);
}

export async function safetyRequestHash(
  operation: string, request: unknown, bindings: Record<string, string>,
) {
  return await requestSha256({ operation, request, bindings });
}

export async function requireV2SafetyDecision(
  ctx: any,
  input: {
    decisionHash: string | undefined;
    operation: "propose" | "request_approval" | "simulate";
    subjectKey: string;
    strategyAccountId: any;
    bindings: Record<string, string>;
    request: unknown;
  },
) {
  if (!input.decisionHash) throw new Error(`A ${input.operation} dependency-safety decision is required.`);
  const decision = await ctx.db.query("safetyEnvelopeProjections")
    .withIndex("by_decisionHash", (query: any) => query.eq("decisionHash", input.decisionHash)).first();
  if (!decision || decision.schemaVersion !== 2 || decision.matrixVersion !== MATRIX_VERSION
    || decision.operation !== input.operation || decision.subjectKey !== input.subjectKey
    || decision.strategyAccountId !== input.strategyAccountId || decision.expiresAt <= Date.now()) {
    throw new Error(`The ${input.operation} v2 safety decision is missing, legacy, expired, or mismatched.`);
  }
  const expectedKeys = ALLOWED_BINDINGS[input.operation];
  const actualKeys = Object.keys(input.bindings).sort();
  if (canonical(actualKeys) !== canonical(expectedKeys)) throw new Error("Safety binding keys are not exact.");
  for (const [key, value] of Object.entries(input.bindings)) {
    if (!value || value.length > 240 || key.length > 80) throw new Error("Safety binding is invalid.");
  }
  let projectedBindings: unknown;
  try { projectedBindings = JSON.parse(decision.bindingsJson); }
  catch { throw new Error("Projected safety bindings are malformed."); }
  if (canonical(projectedBindings) !== canonical(input.bindings)) throw new Error("Safety bindings do not match.");
  if (decision.bindingHash !== await sha256(input.bindings)) throw new Error("Safety binding hash is invalid.");
  const requestHash = await safetyRequestHash(input.operation, input.request, input.bindings);
  if (decision.requestHash !== requestHash) throw new Error("Safety request hash does not match.");
  if (decision.mode === "enforce" && decision.outcome !== "allow") {
    throw new Error(`Dependency safety blocks ${input.operation}.`);
  }
  return decision;
}
