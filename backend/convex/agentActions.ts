import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

export const syncAgentSchedule = action({
  args: { profileId: v.id("agentProfiles") },
  handler: async (ctx, args): Promise<{ synced: number; paused: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication is required.");
    await ctx.runQuery(internal.agentRuntime.authorizeProfileSync, {
      subject: identity.subject,
      profileId: args.profileId,
    });
    const apiUrl = process.env.AGENT_API_URL;
    const secret = process.env.WORKER_SHARED_SECRET;
    if (!apiUrl || !secret) throw new Error("Agent schedule service is not configured.");
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/schedules/sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: args.profileId }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail ?? "Could not synchronize the agent schedule.");
    return payload;
  },
});

export const dispatchApprovedProposal = action({
  args: { proposalId: v.id("tradeProposals") },
  handler: async (ctx, args): Promise<{ workflowId: string; status: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication is required.");
    const authorized = await ctx.runQuery(internal.agentRuntime.authorizeProposalExecution, {
      subject: identity.subject,
      proposalId: args.proposalId,
    });
    if (authorized.status !== "approved") {
      throw new Error("Proposal is not approved for execution.");
    }
    const apiUrl = process.env.AGENT_API_URL;
    const secret = process.env.WORKER_SHARED_SECRET;
    if (!apiUrl || !secret) throw new Error("Execution workflow service is not configured.");
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/executions/dispatch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ proposal_id: args.proposalId, automatic: false }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail ?? "Could not start execution checks.");
    return payload;
  },
});
