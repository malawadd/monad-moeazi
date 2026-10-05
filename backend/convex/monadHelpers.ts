import { getUserByAuthSubject } from "./model";

export const MONAD_CHAIN_ID = 10143;
export const LOCAL_OPERATOR_SUBJECT = "moeazi:operator:local";

export async function requireMeraViewer(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  const owner = String(identity?.walletAddress ?? "").toLowerCase();
  if (!identity || identity.authProvider !== "mera" || !/^0x[a-f0-9]{40}$/.test(owner)
      || identity.subject !== `mera:${owner}`) {
    throw new Error("A valid Mera mobile identity is required.");
  }
  const user = await getUserByAuthSubject(ctx, identity.subject);
  if (!user || user.authProvider !== "mera" || String(user.walletAddress ?? "").toLowerCase() !== owner) {
    throw new Error("Mera account identity does not match its wallet.");
  }
  return { identity, user, owner };
}

export async function requireStoredMeraOwner(ctx: any, subject: string, ownerAddress: string) {
  const owner = ownerAddress.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(owner) || subject !== `mera:${owner}`) {
    throw new Error("Monad owner identity is invalid.");
  }
  const user = await getUserByAuthSubject(ctx, subject);
  if (!user || user.authProvider !== "mera" || String(user.walletAddress ?? "").toLowerCase() !== owner) {
    throw new Error("Mera account identity does not match the requested owner.");
  }
  return { user, owner, subject };
}

export async function requireMonadOperator(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || identity.authProvider !== "local_operator" || identity.subject !== LOCAL_OPERATOR_SUBJECT) {
    throw new Error("Local Monad operator identity is required.");
  }
  return identity;
}

export async function appendMonadActivity(ctx: any, input: {
  userId: any; ownerAddress: string; activityId: string; kind: string; status: string;
  summary: string; operationId?: string; mandateId?: string; txHash?: string; dataJson?: string;
}) {
  await ctx.db.insert("monadActivity", {
    ...input, chainId: MONAD_CHAIN_ID, ownerAddress: input.ownerAddress.toLowerCase(),
    summary: input.summary.slice(0, 300), createdAt: Date.now(),
  });
}

export function safeOperation(row: any) {
  if (!row) return null;
  const { transactionJson, intentJson, signedTransaction: _signedTransaction, ...safe } = row;
  let transaction: unknown = null;
  let intent: unknown = null;
  try { transaction = JSON.parse(transactionJson); } catch { /* corrupt stored data remains hidden */ }
  try { intent = JSON.parse(intentJson); } catch { /* corrupt stored data remains hidden */ }
  return { ...safe, transaction, intent };
}

export async function findMonadOperation(ctx: any, operationId: string) {
  return await ctx.db.query("monadOperations")
    .withIndex("by_operationId", (q: any) => q.eq("operationId", operationId)).first();
}

export async function requireServiceOperation(ctx: any, row: any, ownerAddress: string) {
  await requireMonadOperator(ctx);
  if (!row || row.ownerAddress !== ownerAddress.toLowerCase()) {
    throw new Error("Monad operation belongs to another wallet.");
  }
}
