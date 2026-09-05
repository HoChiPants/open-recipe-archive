import { spawn } from "node:child_process";

const values = process.argv.slice(2);
function valueFor(flag, fallback) {
  const index = values.indexOf(flag);
  return index === -1 ? fallback : values[index + 1];
}
function positiveInteger(flag, fallback) {
  const value = Number(valueFor(flag, fallback));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} must be a positive integer`);
  return value;
}

const count = positiveInteger("--count");
const maxAuthorAttempts = positiveInteger("--max-author-attempts", 3);
if (maxAuthorAttempts > 3) throw new Error("--max-author-attempts cannot exceed 3");
const concurrency = positiveInteger("--concurrency", 4);
if (concurrency > 8) throw new Error("--concurrency cannot exceed 8");
const model = valueFor("--model", "gpt-5.6-luna");
const rightsPolicy = valueFor("--rights-policy", "scraping/config/publication-rights.json");
const rightsAttested = values.includes("--attest-publication-rights");
if (!rightsAttested) {
  throw new Error("batch processing requires --attest-publication-rights; this does not override missing or unapproved rights records");
}

const batchId = `batch-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const releaseId = valueFor("--release", batchId);

async function run(command, args, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...environment },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

console.log(`Batch ${batchId}: normalize the next ${count} candidates with ${model} and concurrency ${concurrency}. Clear candidates use one author call; cached candidates use none; retries and model review are conditional.`);
const normalizationStatus = await run(process.execPath, [
  "scripts/auto-promote-candidates.mjs",
  "--all",
  "--limit", String(count),
  "--model", model,
  "--concurrency", String(concurrency),
  "--max-author-attempts", String(maxAuthorAttempts),
], { RECIPE_PIPELINE_RUN_ID: batchId });

console.log(`Batch ${batchId}: promote passed staged records without additional model calls.`);
const promotionStatus = await run(process.execPath, [
  "scripts/promote-staged-normalizations.mjs",
  "--run-id", batchId,
  "--rights-policy", rightsPolicy,
  "--attest-publication-rights",
]);

console.log(`Batch ${batchId}: build and verify the normalized Daily Dine feed.`);
const feedStatus = await run(process.execPath, [
  "scripts/build-dailydine-feed.mjs",
  "--release", releaseId,
  "--as-of", new Date().toISOString(),
]);

console.log(`Batch ${batchId} complete. Review work/recipe-pipeline/${batchId}, staged-promotion analytics, and build/dailydine-feed before creating an immutable release.`);
if ([normalizationStatus, promotionStatus, feedStatus].some((status) => status !== 0)) process.exitCode = 1;
