import { operatorMutation } from "../api-server/src/monad/convex.js";

const MAX_PAGES_PER_RUN = 100;
let processedTotal = 0;
let updatedTotal = 0;

for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
  const result = await operatorMutation("monadStrategyCatalog", "backfillOptimizerIdentities", { limit: 100 }) as {
    processed: number; updated: number; hasMore: boolean; complete: boolean;
  };
  processedTotal += result.processed;
  updatedTotal += result.updated;
  if (!result.hasMore) {
    console.log(JSON.stringify({ processed: processedTotal, updated: updatedTotal, complete: result.complete }));
    process.exit(0);
  }
}

console.log(JSON.stringify({ processed: processedTotal, updated: updatedTotal, complete: false,
  message: "Page limit reached; rerun to continue from the saved cursor." }));
process.exitCode = 2;
