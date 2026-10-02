import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchApprovedProposal } from "../convex/agentActions";

type Handler = { _handler: (ctx: any, args: any) => Promise<any> };
const call = (fn: unknown, ctx: unknown, args: unknown = {}) =>
  (fn as Handler)._handler(ctx, args);

test("customer dispatch refuses executing proposals before contacting the worker", async () => {
  const priorFetch = globalThis.fetch;
  const priorUrl = process.env.AGENT_API_URL;
  const priorSecret = process.env.WORKER_SHARED_SECRET;
  let fetchCalls = 0;
  process.env.AGENT_API_URL = "http://agent.invalid";
  process.env.WORKER_SHARED_SECRET = "test-secret";
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("worker must not be contacted");
  }) as typeof fetch;
  try {
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: "subject-a" }) },
      runQuery: async () => ({ status: "executing" }),
    };
    await assert.rejects(call(dispatchApprovedProposal, ctx, { proposalId: "proposal-a" }),
      /Proposal is not approved for execution/);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.AGENT_API_URL;
    else process.env.AGENT_API_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.WORKER_SHARED_SECRET;
    else process.env.WORKER_SHARED_SECRET = priorSecret;
  }
});

test("customer dispatch starts an approved proposal", async () => {
  const priorFetch = globalThis.fetch;
  const priorUrl = process.env.AGENT_API_URL;
  const priorSecret = process.env.WORKER_SHARED_SECRET;
  let fetchCalls = 0;
  process.env.AGENT_API_URL = "http://agent.invalid";
  process.env.WORKER_SHARED_SECRET = "test-secret";
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return { ok: true, json: async () => ({ workflowId: "workflow-a", status: "started" }) } as Response;
  }) as typeof fetch;
  try {
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: "subject-a" }) },
      runQuery: async () => ({ status: "approved" }),
    };
    const result = await call(dispatchApprovedProposal, ctx, { proposalId: "proposal-a" });
    assert.deepEqual(result, { workflowId: "workflow-a", status: "started" });
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.AGENT_API_URL;
    else process.env.AGENT_API_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.WORKER_SHARED_SECRET;
    else process.env.WORKER_SHARED_SECRET = priorSecret;
  }
});
