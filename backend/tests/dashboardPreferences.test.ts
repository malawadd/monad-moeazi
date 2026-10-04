import assert from "node:assert/strict";
import { test } from "node:test";
import { get, setTheme } from "../convex/dashboardPreferences";

const read = (get as unknown as { _handler: (ctx: unknown, args: {}) => Promise<{
  layout: string; theme: string; signedIn: boolean;
}> })._handler;
const write = (setTheme as unknown as { _handler: (ctx: unknown, args: { theme: "bold" | "studio" }) => Promise<{
  theme: "bold" | "studio";
}> })._handler;

function context(subject: string | null, users: Record<string, Record<string, unknown>> = {}) {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const ctx = {
    auth: { getUserIdentity: async () => subject ? { subject } : null },
    db: {
      query: (table: string) => {
        assert.equal(table, "users");
        return { withIndex: (index: string, match: (q: { eq: (key: string, value: string) => string }) => string) => {
          assert.equal(index, "by_authSubject");
          const selected = match({ eq: (key, value) => {
            assert.equal(key, "authSubject");
            return value;
          } });
          return { first: async () => users[selected] ?? null };
        } };
      },
      patch: async (id: string, value: Record<string, unknown>) => { patches.push({ id, value }); },
    },
  };
  return { ctx, patches };
}

test("theme defaults to Bold without a strategy account or an existing preference", async () => {
  const signedOut = context(null);
  assert.deepEqual(await read(signedOut.ctx, {}),
    { layout: "workspaces", theme: "bold", signedIn: false });
  const signedIn = context("owner-a", { "owner-a": { _id: "user-a" } });
  assert.deepEqual(await read(signedIn.ctx, {}),
    { layout: "workspaces", theme: "bold", signedIn: true });
});

test("theme save changes only the authenticated user's appearance field", async () => {
  const state = context("owner-b", {
    "owner-a": { _id: "user-a", dashboardTheme: "bold" },
    "owner-b": { _id: "user-b", dashboardLayout: "workbench", dashboardTheme: "bold" },
  });
  assert.deepEqual(await write(state.ctx, { theme: "studio" }), { theme: "studio" });
  assert.equal(state.patches.length, 1);
  assert.equal(state.patches[0].id, "user-b");
  assert.equal(state.patches[0].value.dashboardTheme, "studio");
  assert.equal("dashboardLayout" in state.patches[0].value, false);
  assert.equal(await read(state.ctx, {}).then((result) => result.layout), "workbench");
});

test("theme save rejects unauthenticated and unlinked viewers", async () => {
  const signedOut = context(null);
  await assert.rejects(write(signedOut.ctx, { theme: "studio" }), /Sign in/);
  const unlinked = context("missing-user");
  await assert.rejects(write(unlinked.ctx, { theme: "studio" }), /still connecting/);
  assert.equal(signedOut.patches.length + unlinked.patches.length, 0);
});
