import { readFileSync, readdirSync } from "node:fs";
const root="agent-service/src/moeazi_agent/";
const files=readdirSync(root).filter((name)=>name.startsWith("evidence_integrity")||name==="test_center_evidence_integrity.py");
const forbidden=/^\s*(?:from|import)\s+.*\b(openai|wallet|signer|gateway|sidecar|venue|convex|temporal|requests|urllib|subprocess|socket)\b/im;
for(const file of files){if(forbidden.test(readFileSync(root+file,"utf8"))) throw new Error(`evidence-integrity boundary violation: ${file}`);}
console.log(`evidence-integrity boundary passed (${files.length} files)`);
