import { createHash, createHmac } from "node:crypto";
import { anyApi } from "convex/server";
import { Hono } from "hono";
import { LOCAL_OPERATOR_SUBJECT } from "../../../lib/operatorIdentity.js";
import { operatorConvex } from "./convex.js";
import { startMonadService } from "../lifecycle.js";
import { localMonadServiceUrl } from "./local-service.js";

const ref = (module: string, name: string) => (anyApi as any)[module][name];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function data(context: any) { return context.req.json().then((value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request must be a JSON object.");
  return value as Record<string, any>;
}); }
function failure(context: any, error: unknown, status = 409) {
  return context.json({ error: error instanceof Error ? error.message : "Operator request failed." }, status);
}

export function registerWorkspaceRoutes(app: Hono<any>) {
  app.get("/api/operator/workspace", async (c) => {
    try { return c.json(await (await operatorConvex()).query(ref("operatorLocalBootstrap", "workspace"), {})); }
    catch (error) { return failure(c, error, 503); }
  });
  app.post("/api/operator/teams", async (c) => {
    try {
      const body = await data(c);
      if (typeof body.name !== "string" || !["focus", "pro", "max"].includes(body.tier)) return failure(c, "Enter a team name and a listed tier.", 400);
      const result = await (await operatorConvex()).mutation(ref("agentTeamMutations", "create"), { name: body.name, tier: body.tier });
      return c.json({ ...result, identity: LOCAL_OPERATOR_SUBJECT, paused: true });
    } catch (error) { return failure(c, error); }
  });
  app.post("/api/operator/programs", async (c) => {
    try {
      const body = await data(c);
      if (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 80
          || typeof body.idempotencyKey !== "string" || !/^[a-zA-Z0-9:_-]{16,128}$/.test(body.idempotencyKey)) {
        return failure(c, "Program name and stable idempotency key are required.", 400);
      }
      const convex = await operatorConvex();
      const workspace = await convex.query(ref("operatorLocalBootstrap", "workspace"), {});
      const team = workspace.teams.find((item: any) => !item.archived && item.versions.length);
      const model = workspace.models.find((item: any) => item.status === "draft") ?? workspace.models[0];
      const policy = workspace.policies.find((item: any) => item.status === "draft") ?? workspace.policies[0];
      const version = team?.versions[0];
      if (!workspace.account?.walletless || !team || !version || !model || !policy) return failure(c, "Create an operator-owned team first; a model and policy draft are also required.", 409);
      const draft = await convex.mutation(ref("programOwnership", "createProgramDraft"), {
        name: body.name.trim(), idempotencyKey: body.idempotencyKey,
        sourceStrategyAccountId: workspace.account.strategyAccountId, teamVersionId: version.versionId,
        modelConfigurationId: model.modelConfigurationId, policyId: policy.policyId,
        strategyArtifactHash: sha(version.configJson), adapterProfileHash: sha("moeazi-local-operator-adapter-v1"),
        runtimeCompatibility: "agent-v1",
      });
      let frozen;
      try {
        frozen = await convex.mutation(ref("programOwnership", "freezeProgramVersion"), {
          programId: draft.programId, expectedRevision: 1,
        });
      } catch (error) {
        const catalog = await convex.query(ref("operatorProgramCatalog", "listOwnedPrograms"), {});
        const prior = catalog.programs.find((program: any) => program.programId === draft.programId)?.versions?.[0];
        if (!prior) throw error;
        frozen = { programVersionId: prior.programVersionId, version: prior.version, contentHash: prior.contentHash, duplicate: true };
      }
      return c.json({ ...draft, ...frozen, assignmentChanged: false, identity: LOCAL_OPERATOR_SUBJECT }, 201);
    } catch (error) { return failure(c, error); }
  });
  app.get("/api/operator/experiments/specs", async (c) => {
    try { return c.json({ specs: await (await operatorConvex()).query(ref("programExperiments", "listExperimentSpecs"), {}) }); }
    catch (error) { return failure(c, error, 503); }
  });
  app.post("/api/operator/experiments/specs", async (c) => {
    try {
      const body = await data(c);
      if (Object.keys(body).sort().join(",") !== "controllerKind,controllerVersionId,idempotencyKey,specJson"
          || !["customer_team", "managed_program"].includes(body.controllerKind)
          || typeof body.controllerVersionId !== "string" || typeof body.idempotencyKey !== "string"
          || typeof body.specJson !== "string") return failure(c, "Invalid experiment specification.", 422);
      const result = await (await operatorConvex()).mutation(ref("programExperiments", "freezeExperimentSpec"), body);
      return c.json(result, 201);
    } catch (error) { return failure(c, error); }
  });
  app.get("/api/operator/test-center/registry", async (c) => {
    try {
      const secret = process.env.WORKER_SHARED_SECRET;
      const bridge = process.env.OPERATOR_CONSOLE_BRIDGE_SECRET;
      if (!secret || !bridge) return failure(c, "Test Center service credential is unavailable.", 503);
      const session = createHmac("sha256", bridge).update(`${LOCAL_OPERATOR_SUBJECT}:${Math.floor(Date.now() / 1_800_000)}`).digest("hex");
      const base = new URL(localMonadServiceUrl(process.env.TEST_CENTER_API_URL ?? "http://127.0.0.1:9110", 9110, "Test Center API"));
      const response = await fetch(new URL("/internal/test-center/registry", base), { cache: "no-store", signal: AbortSignal.timeout(4000),
        headers: { Authorization: `Bearer ${secret}`, "X-Moeazi-Subject": LOCAL_OPERATOR_SUBJECT, "X-Moeazi-Session-Id": session } });
      const value = await response.json().catch(() => ({ error: "Test Center returned invalid JSON." }));
      return c.json(value, response.status as any);
    } catch (error) { return failure(c, error, 503); }
  });
  app.post("/api/operator/test-center/start", async (c) => {
    try {
      const body = await data(c);
      if (body.acknowledgement !== "START OPTIONAL TEST CENTER") return failure(c, "Explicit Test Center start acknowledgement is required.", 400);
      if (process.env.AGENT_TEST_CENTER_ENABLED !== "true") return failure(c, "Enable the reviewed local Test Center setting first; setup and repository gates remain in force.", 409);
      await startMonadService("test-center");
      return c.json({ started: true, service: "test-center", effect: "Started only the optional local Test Center container." });
    } catch (error) { return failure(c, error); }
  });
}
