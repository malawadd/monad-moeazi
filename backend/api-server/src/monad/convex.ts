import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { localMonadServiceUrl } from "../operator/local-service.js";
import { operatorConvex } from "../operator/convex.js";

const api = anyApi as any;

function localConvexUrl() {
  const value = process.env.CONVEX_SELF_HOSTED_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!value) throw new Error("Local Monad Convex is unavailable.");
  return localMonadServiceUrl(value, 3310, "Local Monad Convex");
}

export function meraConvex(token: string) {
  const client = new ConvexHttpClient(localConvexUrl());
  client.setAuth(token);
  return client;
}

export async function meraQuery(token: string, moduleName: string, functionName: string, args: unknown) {
  const ref = api[moduleName]?.[functionName];
  if (!ref) throw new Error("Monad Convex query is unavailable.");
  return await (meraConvex(token) as any).query(ref, args);
}

export async function meraMutation(token: string, moduleName: string, functionName: string, args: unknown) {
  const ref = api[moduleName]?.[functionName];
  if (!ref) throw new Error("Monad Convex mutation is unavailable.");
  return await (meraConvex(token) as any).mutation(ref, args);
}

export async function operatorQuery(moduleName: string, functionName: string, args: unknown) {
  const ref = api[moduleName]?.[functionName];
  if (!ref) throw new Error("Monad Convex service query is unavailable.");
  return await (await operatorConvex() as any).query(ref, args);
}

export async function operatorMutation(moduleName: string, functionName: string, args: unknown) {
  const ref = api[moduleName]?.[functionName];
  if (!ref) throw new Error("Monad Convex service mutation is unavailable.");
  return await (await operatorConvex() as any).mutation(ref, args);
}
