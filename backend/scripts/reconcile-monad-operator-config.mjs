import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const operatorSubject = "moeazi:operator:local";
const testCenterSubjects = "moeazi:operator:local,moeazi:fixture:manual-sequence";

async function read(file) {
  try {
    return await readFile(path.join(root, file), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function entries(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    return match ? [[match[1], match[2].replace(/^"|"$/g, "")]] : [];
  }));
}

function setValues(text, updates) {
  const lines = text ? text.split(/\r?\n/) : [];
  for (const [name, value] of Object.entries(updates)) {
    const index = lines.findIndex((line) => line.startsWith(`${name}=`));
    const line = `${name}=${value}`;
    if (index < 0) lines.push(line);
    else lines[index] = line;
  }
  return `${lines.filter((line, index) => index < lines.length - 1 || line).join("\n").replace(/\n*$/, "\n")}`;
}

function hostPostgresDsn(value) {
  if (!value) throw new Error("The local database DSN is unavailable for the API host.");
  let parsed;
  try {
    parsed = new URL(value.replace(/^postgresql\+asyncpg:/, "postgresql:"));
  } catch {
    throw new Error("The local database DSN is invalid for the API host.");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("The local database DSN has an unsupported scheme.");
  }
  if (parsed.hostname === "timescaledb" && parsed.port === "5432") {
    parsed.hostname = "127.0.0.1";
    parsed.port = "15432";
  }
  if (!new Set(["127.0.0.1", "localhost"]).has(parsed.hostname) || parsed.port !== "15432") {
    throw new Error("The API database DSN must point to the local Monad Timescale port 15432.");
  }
  return parsed.toString();
}

const localPath = ".env.local";
const convexPath = ".env.convex.monad";
const agentPath = ".env.agents.monad";
let localText = await read(localPath);
let convexText = await read(convexPath);
let agentText = await read(agentPath);
if (!localText || !convexText || !agentText) {
  throw new Error("Base Monad env files are missing; run scripts/setup-monad-local.ps1 first.");
}

const local = entries(localText);
const agents = entries(agentText);
const bridgeSecret = local.OPERATOR_CONSOLE_BRIDGE_SECRET || randomBytes(32).toString("hex");
const timescaleDsn = local.OPERATOR_TIMESCALE_DSN || hostPostgresDsn(agents.POSTGRES_DSN);
localText = setValues(localText, {
  OPERATOR_CONSOLE_BRIDGE_SECRET: bridgeSecret,
  OPERATOR_TIMESCALE_DSN: timescaleDsn,
});
convexText = setValues(convexText, {
  MONAD_LOCAL_OPERATOR_BOOTSTRAP_ENABLED: "true",
  PROGRAM_OPERATOR_SUBJECTS: operatorSubject,
  PROGRAM_RESEARCH_SUBJECTS: operatorSubject,
  PROGRAM_RELEASE_SUBJECTS: operatorSubject,
});
agentText = setValues(agentText, {
  TEST_CENTER_OPERATOR_SUBJECTS: testCenterSubjects,
  AGENT_TEST_CENTER_OPERATOR_SUBJECTS: testCenterSubjects,
});

const dataDir = path.join(root, ".data");
await mkdir(dataDir, { recursive: true });
const adminSecretPath = path.join(dataDir, "operator-console-admin.secret");
try {
  const existing = (await readFile(adminSecretPath, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(existing)) {
    throw new Error("The existing local operator admin secret is malformed; setup did not change it.");
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  await writeFile(adminSecretPath, `${randomBytes(32).toString("base64url")}\n`, { mode: 0o600 });
}

await writeFile(path.join(root, localPath), localText, { mode: 0o600 });
await writeFile(path.join(root, convexPath), convexText, { mode: 0o600 });
await writeFile(path.join(root, agentPath), agentText, { mode: 0o600 });
console.log("Monad local operator configuration is reconciled.");
