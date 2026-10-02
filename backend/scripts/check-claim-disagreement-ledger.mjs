import { readdirSync, readFileSync } from "node:fs";
const root="agent-service/src/moeazi_agent", names=readdirSync(root).filter((x)=>x.startsWith("claim_disagreement_")&&x.endsWith(".py"));
const forbidden=/^\s*(?:from|import)\s+.*(?:provider|model_routing|ownerSigner|wallet|signer|gateway|sidecar|venue|convex|temporal|requests|httpx|subprocess|socket)/im;
for(const name of names){const text=readFileSync(`${root}/${name}`,"utf8"); if(forbidden.test(text)) throw new Error(`claim ledger forbidden boundary in ${name}`);}
const corpus=JSON.parse(readFileSync(`${root}/claim_disagreement_registry.json`,`utf8`));
if(corpus.scenarios.length<48||corpus.mutations.length<96) throw new Error("claim ledger corpus closure");
console.log(`claim-disagreement-ledger ${names.length} modules clean`);
