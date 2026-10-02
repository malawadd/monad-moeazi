import { readFileSync, readdirSync } from "node:fs";
const root = "agent-service/src/moeazi_agent/";
const files = readdirSync(root).filter((name) => name.startsWith("decision_memory") || name === "test_center_decision_memory.py");
const forbidden = /^\s*(?:from|import)\s+.*\b(openai|wallet|signer|gateway|sidecar|venue|convex|temporal|requests|urllib|subprocess|socket|redis|routing_service|routing_adapters)\b/im;
for (const file of files) if (forbidden.test(readFileSync(root + file, "utf8"))) throw new Error(`decision-memory boundary violation: ${file}`);
console.log(`decision-memory boundary passed (${files.length} files)`);
