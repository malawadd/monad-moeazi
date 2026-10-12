import {cronJobs} from "convex/server";
import {internal} from "./_generated/api";

const crons = cronJobs();
crons.interval("prune expired Mera sign-in challenges", {hours: 1},
  internal.mobile.pruneExpiredAuthChallenges, {limit: 500});
crons.interval("watch Monad venue ticks", {minutes: 1},
  internal.monadVenueWorker.watchdogRuns, {});

export default crons;
