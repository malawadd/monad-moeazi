import type { JsonSchema } from "./types.js";

export function validateSchema(value: unknown, schema: JsonSchema, path = "arguments"): string[] {
  const errors: string[] = [];
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    return [path + " must be one of the reviewed values."];
  }
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const typeMatches = schema.type === actual
    || (schema.type === "number" && actual === "number")
    || (schema.type === "integer" && actual === "number" && Number.isInteger(value));
  if (!typeMatches) return [path + " must be " + schema.type + "."];
  if (schema.type === "object") {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!Object.hasOwn(object, key)) errors.push(path + "." + key + " is required.");
    for (const [key, child] of Object.entries(object)) {
      const childSchema = schema.properties?.[key];
      if (!childSchema && schema.additionalProperties === false) errors.push(path + "." + key + " is not allowed.");
      else if (childSchema) errors.push(...validateSchema(child, childSchema, path + "." + key));
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(...validateSchema(child, schema.additionalProperties, path + "." + key));
      }
    }
  }
  if (schema.type === "array") {
    const array = value as unknown[];
    if (schema.minItems !== undefined && array.length < schema.minItems) errors.push(path + " has too few items.");
    if (schema.maxItems !== undefined && array.length > schema.maxItems) errors.push(path + " has too many items.");
    if (schema.items) array.forEach((item, index) => errors.push(...validateSchema(item, schema.items!, path + "[" + index + "]")));
  }
  if (schema.type === "string") {
    const string = value as string;
    if (schema.minLength !== undefined && string.length < schema.minLength) errors.push(path + " is too short.");
    if (schema.maxLength !== undefined && string.length > schema.maxLength) errors.push(path + " is too long.");
    if (schema.pattern && !new RegExp(schema.pattern).test(string)) errors.push(path + " has an invalid format.");
  }
  if (schema.type === "number" || schema.type === "integer") {
    const number = value as number;
    if (!Number.isFinite(number)) errors.push(path + " must be finite.");
    if (schema.minimum !== undefined && number < schema.minimum) errors.push(path + " is below the minimum.");
    if (schema.maximum !== undefined && number > schema.maximum) errors.push(path + " is above the maximum.");
  }
  return errors;
}

export function hasIdentityOverride(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasIdentityOverride);
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    return ["subject", "userid", "identity", "identitymode", "authprovider", "walletaddress", "particleuuid"]
      .includes(normalized) || hasIdentityOverride(child);
  });
}
