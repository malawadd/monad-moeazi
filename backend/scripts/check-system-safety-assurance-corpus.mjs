import { readdirSync, readFileSync } from "node:fs";
const root="agent-service/src/moeazi_agent", names=readdirSync(root).filter(x=>x.startsWith("safety_assurance_")&&x.endsWith(".py"));
const forbidden=/^\s*(?:import|from)\s+(?:requests|httpx|urllib|socket|websocket|temporalio|convex|subprocess|pathlib|os|shlex)\b/im;
for(const name of names) if(forbidden.test(readFileSync(`${root}/${name}`,"utf8"))) throw new Error(`Feature 27 forbidden boundary import: ${name}`);
const corpus=JSON.parse(readFileSync(`${root}/safety_assurance_registry.json`,"utf8"));
if(corpus.claims.length!==8||corpus.cases.length!==40||corpus.mutations.length!==96) throw new Error("Feature 27 corpus closure invalid");
if(new Set(corpus.cases.map(x=>x.id)).size!==40||new Set(corpus.mutations.map(x=>x.id)).size!==96) throw new Error("Feature 27 duplicate fixture identity");
console.log(`system-safety-assurance ${names.length} modules clean`);
