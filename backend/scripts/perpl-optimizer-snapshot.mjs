import { operatorReadOnlyQuery } from "../api-server/src/monad/convex.js";
import { compactOptimizerRunSnapshot } from "./perpl-optimizer-summary.mjs";

const args = process.argv.slice(2);
let pageSize = 50;
let summaryMode = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--summary") { summaryMode = true; continue; }
  if (args[index] !== "--page-size" || !args[index + 1] || args[index + 1].startsWith("--")) usage();
  const value = Number(args[++index]);
  if (!Number.isInteger(value) || value < 1 || value > 100) usage();
  pageSize = value;
}

const MAX_PAGES = 100;
const generatedAt = new Date().toISOString();
const since = Date.now() - 24 * 60 * 60_000;
const inventoryById = new Map();
let cursor;
let pageCount = 0;
let isDone = false;
while (pageCount < MAX_PAGES) {
  const page = await operatorReadOnlyQuery("monadVenueOptimizer", "listOperatorRuns", {
    limit: pageSize, since, ...(cursor ? { cursor } : {}),
  });
  for (const run of page.runs) inventoryById.set(run.runId, run);
  pageCount++;
  if (!page.hasMore) { isDone = true; break; }
  if (!page.nextCursor) throw new Error("Run inventory returned hasMore without a cursor.");
  cursor = page.nextCursor;
}
if (!isDone) throw new Error("Snapshot stopped at 10,000 recent runs; output is incomplete and must not be treated as full coverage.");

const inventory = [...inventoryById.values()];
const reportable = inventory.filter((run) => run.optimizer);
const snapshots = [];
for (let offset = 0; offset < reportable.length; offset += 4) {
  const batch = reportable.slice(offset, offset + 4);
  snapshots.push(...await Promise.all(batch.map(async (run) => ({
    run: run,
    report: await operatorReadOnlyQuery("monadVenueOptimizer", "getOperatorReport", { runId: run.runId }),
  }))));
}
const reportsById = new Map(snapshots.map((item) => [item.run.runId, item.report]));
const base = { generatedAt, pagesRead: pageCount, runCount: inventory.length, reportableRunCount: reportable.length };
const output = summaryMode
  ? { ...base, mode: "summary", runs: inventory.map((run) => compactOptimizerRunSnapshot({
    inventory: run, report: reportsById.get(run.runId) ?? null })) }
  : { ...base, runs: inventory.map((run) => ({ inventory: run, report: reportsById.get(run.runId) ?? null })) };
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

function usage() {
  process.stderr.write("Usage: node --env-file=.env.local --import tsx scripts/perpl-optimizer-snapshot.mjs [--summary] [--page-size 1-100]\n");
  process.exit(2);
}
