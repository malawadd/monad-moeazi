import { readFileSync, readdirSync } from "node:fs";
const root="agent-service/src/moeazi_agent/";
const files=readdirSync(root).filter((name)=>name.startsWith("portfolio_sizing")||name==="test_center_portfolio_sizing.py");
const forbidden=/^\s*(?:from|import)\s+.*\b(openai|wallet|signer|gateway|sidecar|venue|convex|temporal|requests|urllib|subprocess|socket)\b/im;
for(const file of files){ if(forbidden.test(readFileSync(root+file,"utf8"))) throw new Error(`portfolio-sizing boundary violation: ${file}`); }
console.log(`portfolio-sizing boundary passed (${files.length} files)`);
