import { readdirSync, readFileSync } from "node:fs";
const root="agent-service/src/moeazi_agent"; const names=readdirSync(root).filter(x=>x.startsWith("evidence_event_")&&x.endsWith(".py"));
const forbidden=/^\s*(?:import|from)\s+(?:requests|httpx|urllib|socket|websocket|temporalio|convex|subprocess)\b/im;
for(const name of names) if(forbidden.test(readFileSync(`${root}/${name}`,"utf8"))) throw new Error(`Feature 25 forbidden boundary import: ${name}`);
console.log(`evidence-event-boundary ${names.length} modules clean`);
