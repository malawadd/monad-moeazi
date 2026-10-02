import { readFileSync, readdirSync } from "node:fs"; import { resolve } from "node:path";
const root=resolve(import.meta.dirname,"..","agent-service","src","moeazi_agent");
const files=readdirSync(root).filter(x=>x.startsWith("selective_prediction_")||x==="test_center_selective_prediction.py");
const banned=/\b(from|import)\s+.*\b(requests|httpx|redis|temporal|convex|web3|socket|urllib|wallet|signer|venue|provider)\b/i;
for(const file of files) { const text=readFileSync(resolve(root,file),"utf8"); if(banned.test(text)) throw new Error(`selective prediction boundary violation: ${file}`); if(text.split("\n").length>300) throw new Error(`selective prediction file exceeds 300 lines: ${file}`); }
console.log(`selective prediction boundary passed (${files.length} files)`);
