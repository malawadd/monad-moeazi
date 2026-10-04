import { readFileSync, readdirSync } from "node:fs";
const root="agent-service/src/moeazi_agent/";
const files=readdirSync(root).filter((name)=>name.startsWith("source_value")||name==="test_center_source_value.py");
const forbidden=/^\s*(?:from|import)\s+.*\b(openai|wallet|signer|gateway|sidecar|venue|convex|temporal|requests|urllib|subprocess|socket)\b/im;
for(const file of files){const text=readFileSync(root+file,"utf8"); if(forbidden.test(text)) throw new Error(`source-value boundary violation: ${file}`);}
console.log(`source-value boundary passed (${files.length} files)`);
