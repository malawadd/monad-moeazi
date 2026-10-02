import { readFileSync } from "node:fs";
const paths=["agent-service/src/moeazi_agent/analytical_diversity_evaluator.py","agent-service/src/moeazi_agent/analytical_diversity_test_center_adapter.py","agent-service/src/moeazi_agent/test_center_analytical_diversity.py"];
const banned=/(^|\n)\s*(import|from)\s+.*(openai|requests|httpx|temporal|wallet|signer|venue|execution_sidecar)/i;
for(const path of paths) if(banned.test(readFileSync(path,"utf8"))) throw new Error(`analytical diversity boundary violation: ${path}`);
console.log("analytical-diversity boundary OK");
