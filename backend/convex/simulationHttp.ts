import { anyApi } from "convex/server";
import type { ActionCtx } from "./_generated/server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** The simulation credential must never authenticate the broad worker dispatcher. */
export function broadWorkerCredentialMatches(
  header: string | null, sharedSecret: string, simulationSecret: string | undefined,
) {
  return Boolean(sharedSecret) && header === `Bearer ${sharedSecret}`
    && (!simulationSecret || header !== `Bearer ${simulationSecret}`);
}

/** Dedicated read-only identity endpoint, deliberately outside the command router. */
export async function handleSimulationIdentityRequest(ctx: ActionCtx, request: Request) {
  const secret = process.env.SIMULATION_WORKER_SECRET;
  if (!secret || secret.length < 32 || secret === process.env.WORKER_SHARED_SECRET) {
    return json({ error: "Simulation identity service is unavailable" }, 503);
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ error: "Unauthorized" }, 401);
  }
  const raw = await request.text();
  if (raw.length > 4_096) return json({ error: "Identity request is too large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid request" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request" }, 400);
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "command" && key !== "payload")
      || value.command !== "getSimulationAuthorityContext") return json({ error: "Command forbidden" }, 403);
  const payload = value.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ error: "Invalid identity" }, 400);
  const args = payload as Record<string, unknown>;
  if (Object.keys(args).some((key) => key !== "subject" && key !== "experimentSpecId")
      || typeof args.subject !== "string" || !args.subject || args.subject.length > 512
      || typeof args.experimentSpecId !== "string" || !args.experimentSpecId
      || args.experimentSpecId.length > 160) return json({ error: "Invalid identity" }, 400);
  try {
    const result = await ctx.runQuery(anyApi.simulationAuthority.getContext, {
      subject: args.subject, experimentSpecId: args.experimentSpecId,
    });
    return json(result);
  } catch {
    return json({ error: "Current simulation identity is unavailable" }, 503);
  }
}
