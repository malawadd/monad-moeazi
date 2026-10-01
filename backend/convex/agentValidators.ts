import { v } from "convex/values";

export const intelligenceTier = v.union(
  v.literal("focus"),
  v.literal("pro"),
  v.literal("max"),
);

export const authorityMode = v.union(
  v.literal("shadow"),
  v.literal("insights"),
  v.literal("approval_required"),
  v.literal("autopilot"),
);

export const agentLifecycleStatus = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("blocked"),
);

export const analysisCadence = v.union(
  v.literal("on_demand"),
  v.literal("15m"),
  v.literal("5m"),
  v.literal("2m"),
  v.literal("1m"),
);

export const analysisScope = v.union(v.literal("public"), v.literal("private"));

export const controllerRefValidator = v.object({
  schemaVersion: v.literal(1),
  environment: v.union(v.literal("live"), v.literal("experiment")),
  strategyAccountId: v.string(),
  controllerKind: v.union(v.literal("customer_team"), v.literal("managed_program")),
  controllerId: v.string(),
  controllerVersionId: v.string(),
  contentHash: v.string(),
});

export const modelProvider = v.union(
  v.literal("openai"), v.literal("deepseek"), v.literal("openrouter"),
);

export const credentialSource = v.union(v.literal("platform"), v.literal("byok"));

export const analysisJobStatus = v.union(
  v.literal("queued"),
  v.literal("claimed"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const proposalStatus = v.union(
  v.literal("insight"),
  v.literal("simulated"),
  v.literal("pending_approval"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("executing"),
  v.literal("executed"),
  v.literal("failed"),
  v.literal("expired"),
  v.literal("blocked"),
);

export const managedVenueRole = v.union(
  v.literal("arbitrum_ua_owner"),
  v.literal("arbitrum_managed_vault"),
  v.literal("optimism_execution_wallet"),
  v.literal("hyperliquid_master_wallet"),
  v.literal("hyperliquid_agent_wallet"),
  v.literal("lighter_trading_account"),
  v.literal("orderly_trading_account"),
  v.literal("gmx_trading_wallet"),
  v.literal("ostium_trading_wallet"),
);

export const managedTradingVenue = v.union(
  v.literal("uniswap"),
  v.literal("hyperliquid"),
  v.literal("lighter"),
  v.literal("orderly"),
  v.literal("gmx"),
  v.literal("ostium"),
);
