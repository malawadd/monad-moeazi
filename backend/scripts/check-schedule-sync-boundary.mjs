import { readdirSync, readFileSync } from "node:fs";
const root="agent-service/src/moeazi_agent"; const names=readdirSync(root).filter(x=>x.startsWith("schedule_sync_")&&x.endsWith(".py"));
const forbidden=/^\s*(?:import|from)\s+(?:requests|httpx|urllib|socket|websocket|temporalio|convex|subprocess|pathlib)\b/im;
for(const name of names) if(forbidden.test(readFileSync(`${root}/${name}`,"utf8"))) throw new Error(`Feature 26 forbidden boundary import: ${name}`);
console.log(`schedule-sync-boundary ${names.length} modules clean`);
