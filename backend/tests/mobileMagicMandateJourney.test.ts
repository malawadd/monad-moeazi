import assert from "node:assert/strict";
import { test } from "node:test";
import { stageInternalSpot } from "../convex/internalSpotProgramBootstrap";
import { confirmAutopilotMode } from "../convex/mobile";
import { request, getProvisioningContext } from "../convex/managedSpotMandates";
import { resolveManagedProgramContext } from "../convex/managedProgramRuntime";

const owner = "0x56b6c8ef6e04fa995f835f56c009f01623af5963";
type Row = Record<string, any> & { _id: string };
const handler = (fn: unknown) => (fn as { _handler: (ctx: any, args: any) => Promise<any> })._handler;

function store() {
  const rows = new Map<string, Row[]>();
  const add = (table: string, row: Row) => rows.set(table, [...(rows.get(table) ?? []), row]);
  add("users", { _id: "customer", authSubject: `magic:${owner}`,
    authProvider: "magic", walletAddress: owner });
  add("accountWallets", { _id: "magic-wallet", userId: "customer",
    walletProvider: "magic", ownerAddress: owner, accountMode: "eip7702",
    ownerVerifiedAt: Date.now(), eip7702Delegated: true,
    accountImplementation: "0x13e00e089f81ad9f36b655c9e9a07c6bf1489a5a",
    arbitrumBalanceBlock: 100, arbitrumBalanceObservedAt: Date.now() });
  add("accountWallets", { _id: "legacy-particle", userId: "customer",
    walletProvider: "particle", ownerAddress: owner, ownerVerifiedAt: Date.now() });
  add("strategyAccounts", { _id: "magic-strategy", userId: "customer",
    accountWalletId: "magic-wallet", status: "ready", emergencyStop: false });
  const db = {
    get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}-${(rows.get(table) ?? []).length + 1}`;
      add(table, { _id: id, ...value });
      return id;
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      const row = await db.get(id);
      if (!row) throw new Error(`Missing ${id}`);
      Object.assign(row, value);
    },
    query: (table: string) => {
      const conditions: Array<[string, unknown]> = [];
      let descending = false;
      const chain = {
        withIndex: (_name: string, filter: (q: any) => any) => {
          const q = { eq(key: string, value: unknown) { conditions.push([key, value]); return q; } };
          filter(q);
          return chain;
        },
        order: (direction: string) => { descending = direction === "desc"; return chain; },
        collect: async () => {
          const selected = (rows.get(table) ?? []).filter((row) =>
            conditions.every(([key, value]) => row[key] === value));
          return descending ? [...selected].reverse() : selected;
        },
        first: async () => (await chain.collect())[0] ?? null,
      };
      return chain;
    },
  };
  const ctx = { db, auth: { getUserIdentity: async () => ({
    subject: `magic:${owner}`, authProvider: "magic", walletAddress: owner,
  }) } };
  return { ctx, rows };
}

test("Magic signup account reaches its own program mandate and vault provisioning context", async () => {
  const { ctx, rows } = store();
  const staged = await handler(stageInternalSpot)(ctx, { customerOwnerAddress: owner });
  assert.equal(staged.customerOwnerAddress, owner);
  assert.equal(staged.assignmentStatus, "paused");
  const confirmed = await handler(confirmAutopilotMode)(ctx, { confirmed: true });
  assert.equal(confirmed.controllerMode, "autopilot");
  assert.equal(confirmed.started, false);
  assert.equal(rows.get("strategyAccounts")![0].status, "active");
  const mandate = await handler(request)(ctx, {
    capitalUnits: "500000", durationDays: 7, idempotencyKey: "magic-journey-001",
  });
  assert.equal(mandate.status, "awaiting_vault");
  const context = await handler(getProvisioningContext)(ctx, { mandateId: mandate.mandateId });
  assert.equal(context?.ownerAddress, owner);
  assert.equal(context?.capitalUnits, "500000");
  assert.equal(context?.programHash, staged.contentHash);
  assert.equal(rows.get("managedSpotMandates")?.length, 1);
  assert.equal(rows.get("accountWallets")![1]._id, "legacy-particle");
});

test("the same Magic account can renew only an expired mandate with no deployment or funding", async () => {
  const { ctx, rows } = store();
  await handler(stageInternalSpot)(ctx, { customerOwnerAddress: owner });
  await handler(confirmAutopilotMode)(ctx, { confirmed: true });
  const first = await handler(request)(ctx, {
    capitalUnits: "500000", durationDays: 1, idempotencyKey: "magic-renew-001",
  });
  const old = rows.get("managedSpotMandates")![0];
  old.expiresAt = Date.now() - 1_000;
  const renewed = await handler(request)(ctx, {
    capitalUnits: "500000", durationDays: 1, idempotencyKey: "magic-renew-002",
  });
  assert.notEqual(renewed.mandateId, first.mandateId);
  assert.equal(old.status, "expired_unfunded");
  assert.equal((await handler(getProvisioningContext)(ctx, { mandateId: first.mandateId })), null);
  const current = rows.get("managedSpotMandates")![1];
  current.expiresAt = Date.now() - 1_000;
  current.provisioningState = "claimed";
  await assert.rejects(() => handler(request)(ctx, {
    capitalUnits: "500000", durationDays: 1, idempotencyKey: "magic-renew-003",
  }), /Resolve the existing mandate/);
});

test("managed analysis carries the funded Magic vault order cap into proposal sizing", async () => {
  const { ctx, rows } = store();
  const staged = await handler(stageInternalSpot)(ctx, { customerOwnerAddress: owner });
  await handler(confirmAutopilotMode)(ctx, { confirmed: true });
  const mandate = await handler(request)(ctx, {
    capitalUnits: "500000", durationDays: 1, idempotencyKey: "magic-order-cap-001",
  });
  const fundedMandate = rows.get("managedSpotMandates")![0];
  fundedMandate.status = "active";
  fundedMandate.vaultAddress = "0x1111111111111111111111111111111111111111";
  rows.get("programAssignments")![0].status = "active";
  const strategy = rows.get("strategyAccounts")!.find((row) => row._id === "magic-strategy")!;
  const context = await resolveManagedProgramContext(ctx, {
    userId: "customer", strategyAccountId: strategy._id,
    programAssignmentId: staged.assignmentId, programVersionId: staged.programVersionId,
    controllerMode: "autopilot", tier: "focus", marketId: "WETH-USDC",
    controllerRef: { schemaVersion: 1, environment: "live", strategyAccountId: strategy._id,
      controllerKind: "managed_program", controllerId: String(staged.assignmentId),
      controllerVersionId: String(staged.programVersionId), contentHash: staged.contentHash },
  }, strategy);
  assert.equal(mandate.status, "awaiting_vault");
  assert.equal(context?.managedSpotOrderCapUnits, "500000");
});
