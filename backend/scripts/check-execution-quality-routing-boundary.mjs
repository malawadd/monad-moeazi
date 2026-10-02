import { readFileSync, readdirSync } from "node:fs";
const root="agent-service/src/moeazi_agent/";
const files=readdirSync(root).filter((name)=>name.startsWith("execution_quality")||name==="test_center_execution_quality.py");
const forbidden=/^\s*(?:from|import)\s+.*\b(openai|wallet|signer|gateway|sidecar|venue|convex|temporal|requests|urllib|subprocess|socket|routing_service|routing_adapters)\b/im;
for(const file of files){ if(forbidden.test(readFileSync(root+file,"utf8"))) throw new Error(`execution-quality boundary violation: ${file}`); }
console.log(`execution-quality boundary passed (${files.length} files)`);
