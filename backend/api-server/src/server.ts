import { serve } from "@hono/node-server";
import { loadMonadEnvironment } from "./environment.js";

await loadMonadEnvironment();
const { createApiApp } = await import("./app.js");
const app = await createApiApp();
const port = Number(process.env.MOEAZI_API_PORT ?? 3102);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("MOEAZI_API_PORT is invalid.");

const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  process.stdout.write(`[api] Moeazi Monad API listening on http://127.0.0.1:${info.port}\n`);
});

function stop(): void {
  server.close(() => process.exit(0));
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
