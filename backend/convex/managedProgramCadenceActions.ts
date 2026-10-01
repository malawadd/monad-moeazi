import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export const syncManagedProgramSchedule = internalAction({
  args: { assignmentId: v.id("programAssignments") },
  handler: async (_ctx, args) => {
    const apiUrl = process.env.AGENT_API_URL;
    const secret = process.env.WORKER_SHARED_SECRET;
    if (!apiUrl || !secret) throw new Error("Managed schedule service is not configured.");
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/schedules/managed-sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ assignment_id: args.assignmentId }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail ?? "Could not synchronize the managed program schedule.");
    }
    return payload;
  },
});
