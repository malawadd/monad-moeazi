import { readFileSync, readdirSync } from "node:fs";
const root="agent-service/src/moeazi_agent/";
const files=readdirSync(root).filter((name)=>name.startsWith("shadow_tca")||name==="test_center_shadow_tca.py");
const forbidden=/^\s*(?:from|import)\s+.*\b(openai|wallet|signer|gateway|sidecar|venue|convex|temporal|requests|urllib|subprocess|socket|routing_service|routing_adapters)\b/im;
for(const file of files){if(forbidden.test(readFileSync(root+file,"utf8")))throw new Error(`shadow-tca boundary violation: ${file}`);}
console.log(`shadow-tca boundary passed (${files.length} files)`);
