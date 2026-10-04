import test from "node:test";
import assert from "node:assert/strict";
import { providerErrorMessage } from "../lib/modelProviders";

test("provider validation errors render as readable field messages", () => {
  const message = providerErrorMessage({
    detail: [{
      type: "literal_error",
      loc: ["body", "provider"],
      msg: "Input should be 'openai', 'deepseek', or 'openrouter'",
      input: "other",
    }],
  }, 422);
  assert.equal(
    message,
    "provider: Input should be 'openai', 'deepseek', or 'openrouter'",
  );
  assert.notEqual(message, "[object Object]");
});

test("provider errors fall back without exposing raw objects", () => {
  assert.equal(providerErrorMessage({ error: { message: "Balance exhausted" } }, 402), "Balance exhausted");
  assert.equal(providerErrorMessage({}, 500), "Provider service returned 500.");
});
