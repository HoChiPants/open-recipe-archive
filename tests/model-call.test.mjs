import assert from "node:assert/strict";
import test from "node:test";

import { mapWithConcurrency, parseStructuredModelOutput, withModelRetries } from "../scripts/model-call-lib.mjs";

test("rejects malformed or non-object model output", () => {
  assert.throws(() => parseStructuredModelOutput("not json"), /malformed structured model output/);
  assert.throws(() => parseStructuredModelOutput("[]"), /expected a JSON object/);
});

test("retries transient malformed output and returns structured JSON", async () => {
  let calls = 0;
  const value = await withModelRetries(async () => {
    calls += 1;
    return parseStructuredModelOutput(calls === 1 ? "{" : '{"status":"usable"}');
  }, { attempts: 2 });
  assert.equal(calls, 2);
  assert.deepEqual(value, { status: "usable" });
});

test("stops after the configured retry budget", async () => {
  let calls = 0;
  await assert.rejects(() => withModelRetries(async () => {
    calls += 1;
    return parseStructuredModelOutput("bad");
  }, { attempts: 3 }), /malformed structured model output/);
  assert.equal(calls, 3);
});

test("maps work concurrently while preserving input order and the concurrency bound", async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await mapWithConcurrency([40, 5, 20, 10], 2, async (delay, index) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active -= 1;
    return `${index}:${delay}`;
  });
  assert.equal(maximumActive, 2);
  assert.deepEqual(results, ["0:40", "1:5", "2:20", "3:10"]);
});
