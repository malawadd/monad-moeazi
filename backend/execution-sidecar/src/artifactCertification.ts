/** Pure local fixture identity helpers.  This module never reads a chain or env. */
import { keccak256, stringToHex, toHex } from "viem";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function normalize(value: unknown): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error("artifact canonical JSON prohibits floats");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, normalize(source[key])]));
  }
  throw new Error("artifact canonical JSON value is unsupported");
}

export function artifactCanonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

/** Keccak fixtures cover byte/selector/pool identities; no endpoint is involved. */
export function artifactKeccak(value: unknown): `0x${string}` {
  return keccak256(stringToHex(artifactCanonicalJson(value)));
}

export function artifactSelector(signature: string): `0x${string}` {
  if (!/^[A-Za-z_][A-Za-z0-9_]*\([^\s]*\)$/.test(signature)) throw new Error("invalid fixture selector");
  return `${keccak256(stringToHex(signature)).slice(0, 10)}` as `0x${string}`;
}

export function artifactByteIdentity(bytes: `0x${string}`): `0x${string}` {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(bytes)) throw new Error("fixture bytes must be nonempty even hex");
  return keccak256(toHex(bytes));
}
