import { readFile } from "node:fs/promises";
import path from "node:path";

function parseEnvironment(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function loadFile(filePath: string): Promise<void> {
  try {
    const parsed = parseEnvironment(await readFile(filePath, "utf8"));
    for (const [name, value] of Object.entries(parsed)) {
      if (process.env[name] === undefined) process.env[name] = value;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function loadMonadEnvironment(root = process.cwd()): Promise<void> {
  await loadFile(path.join(root, ".env.local"));
  await loadFile(path.join(root, ".env.agents.monad"));
  if (process.env.OPERATOR_TIMESCALE_DSN) {
    process.env.POSTGRES_DSN = process.env.OPERATOR_TIMESCALE_DSN;
  }
}
