import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import { registerWorkspaceRoutes } from "../api-server/src/operator/workspace-routes.js";

test("operator console workspace and local fixture pages have registered endpoints", () => {
  const app = new Hono(); registerWorkspaceRoutes(app);
  const routes = new Set(app.routes.map((route) => `${route.method} ${route.path}`));
  for (const route of ["GET /api/operator/workspace", "POST /api/operator/teams", "POST /api/operator/programs",
    "GET /api/operator/experiments/specs", "POST /api/operator/experiments/specs",
    "GET /api/operator/test-center/registry", "POST /api/operator/test-center/start"]) {
    assert.ok(routes.has(route), `Missing ${route}`);
  }
});
