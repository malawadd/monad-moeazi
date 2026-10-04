import { readFileSync, readdirSync } from "node:fs"; import { resolve } from "node:path";
const root=resolve(import.meta.dirname,"..","agent-service","src","moeazi_agent");
const files=readdirSync(root).filter(x=>x.startsWith("promotion_")||x==="test_center_promotion.py");
const banned=/\b(from|import)\s+.*\b(requests|httpx|redis|temporal|convex|web3|socket|urllib)\b/i;
for(const file of files) if(banned.test(readFileSync(resolve(root,file),"utf8"))) throw new Error(`promotion boundary violation: ${file}`);
console.log(`promotion boundary passed (${files.length} files)`);
