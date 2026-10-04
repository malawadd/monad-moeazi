import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync("agent-service/src/moeazi_agent/test_center_api.py", "utf8");

assert.match(api, /asset-conservation-journal/);
