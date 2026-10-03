import assert from "node:assert/strict";
import { test } from "node:test";
import { ManualSequenceEngine } from "./engine.js";
import { sourceOfPythonRoute, sourceOfSidecarRoutes } from "./discovery.js";
import { assertLocalConvexUrl, assertMonadServiceUrl } from "./invoke.js";
import { sanitize, sanitizeReceipt } from "./canonical.js";
import { hasIdentityOverride } from "./schema.js";
import { InvocationError, type FunctionDescriptor, type PlannedStep, type SequenceSession } from "./types.js";
import type { SequenceStore } from "./store.js";

const reviewedRead: FunctionDescriptor = {
  id: "fixture:read", version: 1, title: "Read fixture", source: "agent", kind: "http",
  target: { method: "GET", path: "/health" }, reviewed: true, runnable: true,
  argumentSchema: { type: "object", properties: { n: { type: "integer" } }, required: ["n"], additionalProperties: false },
  identityModes: ["operator"], requiredAuthority: "Fixed local operator context.",
  effectDescription: "Reads fixture state.", possibleEffects: [],
  cost: { class: "none", description: "No cost." }, safety: "read_only", mutation: false,
};

class MemoryStore implements SequenceStore {
  readonly receipts = new Map<number, any>();
  status = "running";
  private resolve!: () => void;
  private finished = new Promise<void>((resolve) => { this.resolve = resolve; });
  async recoverAbandonedSessions() { return 0; }
  async createSession(input: { sessionId: string; steps: PlannedStep[] }) {
    input.steps.forEach((step) => this.receipts.set(step.ordinal, { status: "queued", functionId: step.function.id }));
    return { sessionId: input.sessionId, created: true };
  }
  async beginStep(_id: string, ordinal: number) { this.receipts.get(ordinal).status = "running"; }
  async finishStep(_id: string, ordinal: number, status: any, result?: unknown, error?: unknown) {
    this.receipts.set(ordinal, { status, result, error });
  }
  async finishSession(_id: string, status: any) { this.status = status; this.resolve(); }
  async getSession(_subject: string, sessionId: string): Promise<SequenceSession | null> {
    return { sessionId, operatorSubject: "moeazi:operator:local", previewHash: "x", catalogVersion: "test",
      status: this.status as any, continueAfterFailure: true, createdAt: "", updatedAt: "", steps: [] };
  }
  async listSessions(): Promise<SequenceSession[]> { return []; }
  async wait() { await this.finished; }
}

function setup(invoke: (step: PlannedStep, sessionId: string) => Promise<unknown> = async () => ({ ok: true })) {
  const store = new MemoryStore();
  const calls: number[] = [];
  const engine = new ManualSequenceEngine({
    store, catalog: async () => ({ catalogVersion: "catalog-test", functions: [reviewedRead] }),
    invoke: async ({ args, sessionId }) => {
      calls.push((args as { n: number }).n);
      return await invoke({ ordinal: 0, args, identityMode: "operator", function: reviewedRead } as PlannedStep, sessionId);
    },
  });
  return { engine, store, calls };
}

function request(numbers: number[], continueAfterFailure: boolean) {
  return { continueAfterFailure, steps: numbers.map((n) => ({
    functionId: reviewedRead.id, args: { n }, identityMode: "operator",
  })) };
}

test("preview validates a static sequence without invoking functions", async () => {
  const { engine, calls } = setup();
  const preview = await engine.createPreview("moeazi:operator:local", request([1, 2], false));
  assert.equal(calls.length, 0);
  assert.equal(preview.steps.length, 2);
  assert.equal(preview.steps[0].ordinal, 1);
  assert.equal(preview.steps[1].ordinal, 2);
});

test("confirmation is bound to the exact preview hash", async () => {
  const { engine, calls } = setup();
  const preview = await engine.createPreview("moeazi:operator:local", request([1], false));
  await assert.rejects(() => engine.execute("moeazi:operator:local", {
    previewId: preview.previewId, hash: "0".repeat(64),
  }), /does not match/);
  assert.equal(calls.length, 0);
});

test("execution preserves call order and can continue after a definite failure", async () => {
  const { engine, store, calls } = setup(async (step) => {
    if ((step.args as { n: number }).n === 2) throw new InvocationError("rejected before effect", "definite", 409);
    return { ok: true };
  });
  const preview = await engine.createPreview("moeazi:operator:local", request([1, 2, 3], true));
  await engine.execute("moeazi:operator:local", { previewId: preview.previewId, hash: preview.hash });
  await store.wait();
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(store.status, "partially_failed");
});

test("an uncertain mutation stops the sequence even when continue is enabled", async () => {
  const { engine, store, calls } = setup(async (step) => {
    if ((step.args as { n: number }).n === 1) throw new InvocationError("connection lost", "uncertain");
    return { ok: true };
  });
  const preview = await engine.createPreview("moeazi:operator:local", {
    continueAfterFailure: true, steps: [1, 2].map((n) => ({ functionId: reviewedRead.id, args: { n }, identityMode: "operator" })),
  });
  await engine.execute("moeazi:operator:local", { previewId: preview.previewId, hash: preview.hash });
  await store.wait();
  assert.deepEqual(calls, [1]);
  assert.equal(store.status, "uncertain");
  assert.equal(store.receipts.get(2).status, "skipped");
});

test("subject injection and unauthorized identity modes are rejected; resource IDs are not identity", async () => {
  const { engine } = setup();
  await assert.rejects(() => engine.createPreview("moeazi:operator:local", {
    continueAfterFailure: false, steps: [{ functionId: reviewedRead.id, args: { n: 1, subject: "customer" }, identityMode: "operator" }],
  }), /derived by the server/);
  await assert.rejects(() => engine.createPreview("moeazi:operator:local", {
    continueAfterFailure: false, steps: [{ functionId: reviewedRead.id, args: { n: 1 }, identityMode: "fixture" }],
  }), /does not allow that identity/);
  assert.equal(hasIdentityOverride({ teamId: "operator-team-id" }), false);
  assert.equal(hasIdentityOverride({ nested: { auth: { subject: "customer" } } }), true);
});

test("Convex calls are pinned to the exact loopback Monad endpoint", () => {
  assert.equal(assertLocalConvexUrl("http://127.0.0.1:3310"), "http://127.0.0.1:3310");
  assert.equal(assertLocalConvexUrl("http://localhost:3310/"), "http://localhost:3310");
  for (const value of ["https://convex.example.com", "http://127.0.0.1:3311",
    "http://127.0.0.1:3310/admin", "http://user:pass@127.0.0.1:3310",
    "http://127.0.0.1:3310/?target=other", "http://127.0.0.1:3310/#fragment"]) {
    assert.throws(() => assertLocalConvexUrl(value), /loopback Monad deployment on port 3310/);
  }
});

test("reviewed HTTP calls are pinned to each Monad service port", () => {
  for (const [source, port] of [["agent", 9100], ["execution", 9200], ["sidecar", 9300], ["test-center", 9110]] as const) {
    assert.equal(assertMonadServiceUrl(source, `http://127.0.0.1:${port}`), `http://127.0.0.1:${port}`);
    assert.throws(() => assertMonadServiceUrl(source, `http://127.0.0.1:${port + 1}`), new RegExp(`port ${port}`));
    assert.throws(() => assertMonadServiceUrl(source, `http://operator:secret@127.0.0.1:${port}`), /restricted to the loopback Monad service/);
  }
  assert.throws(() => assertMonadServiceUrl("agent", "https://agent.example.com:9100"), /restricted to the loopback Monad service/);
});

test("persisted and exported sequence details redact service credentials", () => {
  const receipt = sanitizeReceipt({ args: { nested: { credential: "provider-secret", mnemonic: "word phrase",
      walletPrivateKey: "0xsecret", idempotencyKey: "client-retry-42" } },
    result: { provider: { apiKey: "secret-value" }, detail: "Bearer provider-token" },
    error: { message: "api_key=hidden-value; database postgresql://ops:db-password@127.0.0.1:5432/moeazi unavailable" } });
  assert.deepEqual(receipt, { args: { nested: { credential: "[REDACTED]", mnemonic: "[REDACTED]",
    walletPrivateKey: "[REDACTED]", idempotencyKey: "client-retry-42" } },
  result: { provider: { apiKey: "[REDACTED]" }, detail: "[REDACTED]" },
  error: { message: "[REDACTED]; database [REDACTED] unavailable" } });
  assert.deepEqual(sanitize({ authorization: "Bearer credential" }), { authorization: "[REDACTED]" });
});

test("reviewed Test Center idempotency key reaches the single target attempt", async () => {
  const store = new MemoryStore();
  let attempts = 0;
  let sent: unknown;
  const create: FunctionDescriptor = { ...reviewedRead, id: "fixture:create", title: "Create fixture",
    kind: "http", target: { method: "POST", path: "/runs" }, mutation: true,
    idempotencyArgument: "request_key", argumentSchema: { type: "object",
      properties: { n: { type: "integer" }, request_key: { type: "string" } }, required: ["n", "request_key"],
      additionalProperties: false } };
  const engine = new ManualSequenceEngine({ store,
    catalog: async () => ({ catalogVersion: "idempotency-v1", functions: [create] }),
    invoke: async ({ args }) => { attempts += 1; sent = args; return { ok: true }; },
  });
  const preview = await engine.createPreview("moeazi:operator:local", { continueAfterFailure: false,
    steps: [{ functionId: create.id, args: { n: 9 }, identityMode: "operator", idempotencyKey: "client-key-123" }] });
  assert.equal((preview.steps[0].args as any).request_key, "client-key-123");
  await engine.execute("moeazi:operator:local", { previewId: preview.previewId, hash: preview.hash });
  await store.wait();
  assert.deepEqual(sent, { n: 9, request_key: "client-key-123" });
  await assert.rejects(() => engine.execute("moeazi:operator:local", { previewId: preview.previewId, hash: preview.hash }));
  assert.equal(attempts, 1);
});

test("a newly closed reviewed-function gate invalidates an unexpired preview", async () => {
  const store = new MemoryStore();
  let runnable = true;
  let calls = 0;
  const engine = new ManualSequenceEngine({ store,
    catalog: async () => ({ catalogVersion: runnable ? "gate-open" : "gate-closed",
      functions: [{ ...reviewedRead, runnable }] }),
    invoke: async () => { calls += 1; return {}; },
  });
  const preview = await engine.createPreview("moeazi:operator:local", request([1], false));
  runnable = false;
  await assert.rejects(() => engine.execute("moeazi:operator:local", { previewId: preview.previewId, hash: preview.hash }), /safety gate changed/);
  assert.equal(calls, 0);
});

test("high-impact calls require the extra acknowledgement and stop on an uncontinued definite failure", async () => {
  const store = new MemoryStore();
  const paid = { ...reviewedRead, safety: "paid" as const };
  const calls: number[] = [];
  const engine = new ManualSequenceEngine({ store,
    catalog: async () => ({ catalogVersion: "paid-v1", functions: [paid] }),
    invoke: async ({ args }) => {
      const n = (args as { n: number }).n; calls.push(n);
      if (n === 1) throw new InvocationError("definite rejection", "definite", 409);
      return { ok: true };
    },
  });
  const preview = await engine.createPreview("moeazi:operator:local", request([1, 2], false));
  assert.equal(preview.requiresAcknowledgement, true);
  await assert.rejects(() => engine.execute("moeazi:operator:local", { previewId: preview.previewId, hash: preview.hash }), /Explicit acknowledgement/);
  await engine.execute("moeazi:operator:local", { previewId: preview.previewId, hash: preview.hash, acknowledgeHighImpact: true });
  await store.wait();
  assert.deepEqual(calls, [1]);
  assert.equal(store.receipts.get(2).status, "skipped");
});

test("inventory parsers retain multiple router prefixes and branched sidecar paths", () => {
  const python = sourceOfPythonRoute('first = APIRouter(prefix="/v1/one")\nsecond = APIRouter(prefix="/internal/two")\n@first.get("/status")\nasync def a(): pass\n@second.post("/runs")\nasync def b(): pass', "agent");
  assert.deepEqual(python.map((item) => item.id).sort(), ["agent:GET /v1/one/status", "agent:POST /internal/two/runs"]);
  const sidecar = sourceOfSidecarRoutes('if (req.method === "GET" && new URL(req.url ?? "", "http://local").pathname === "/health") {}\nif (req.method === "POST" && (req.url === "/runs/read" || req.url === "/runs/submit")) {}');
  assert.deepEqual(sidecar.map((item) => item.id).sort(), ["sidecar:GET /health", "sidecar:POST /runs/read", "sidecar:POST /runs/submit"]);
  assert.ok(sidecar.some((item) => item.id === "sidecar:GET /health"));
  assert.ok(sidecar.some((item) => item.id === "sidecar:POST /runs/read"));
  assert.ok(sidecar.some((item) => item.id === "sidecar:POST /runs/submit"));
});
