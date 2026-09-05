import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  archiveIdForRecipe, buildDailyDineFeed, canonicalSourceUrl, compareUnicodeCodePoints,
  contentHashForRecipe, verifyBuiltFeed,
} from "../scripts/dailydine-feed-lib.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const recipe = {
  schema_version: "1.0.0", id: "simple-flatbread", name: "Simple Flatbread",
  description: "A quick stovetop flatbread.", meal_type: "side",
  yield: { quantity: 4, unit: "flatbreads" }, times: { prep_minutes: 10, cook_minutes: 10 },
  ingredients: [
    { ingredient_id: "flour", item: "flour", quantity: 1, unit: "cup" },
    { ingredient_id: "water", item: "water", quantity: 0.5, unit: "cup" },
  ],
  instructions: [{ step: 1, text: "Mix into a soft dough." }, { step: 2, text: "Cook in a hot skillet." }],
  tags: ["bread"],
  source: { name: "Example", url: "https://www.example.com/recipes/flatbread#method", adapted: true },
  normalization: {
    source_text_hash: hash("source"), normalized_text_hash: hash("normalized"),
    model: "gpt-5.3-codex-spark", model_version: "gpt-5.3-codex-spark", prompt_version: "2.1.0",
    transformed_at: "2026-09-01T12:00:00.000Z", semantic_similarity: 35, structural_similarity: 30,
    requires_review: false, source_review_status: "passed",
  },
  created_at: "2026-09-01", updated_at: "2026-09-01",
};

async function withTemp(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dailydine-feed-"));
  try { return await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

async function writeRecipe(directory, name, value) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function buildOne(directory, value = recipe) {
  const inputDir = path.join(directory, "input");
  const outputDir = path.join(directory, "output");
  await writeRecipe(inputDir, "recipe.json", value);
  const manifest = await buildDailyDineFeed({
    inputDir, outputDir, releaseId: "test-release", generatedAt: "2026-09-01T13:00:00.000Z", pageSize: 250,
  });
  return { manifest, outputDir };
}

test("derives stable archive identity only from canonical source URL", () => {
  const sourceUrl = canonicalSourceUrl(recipe.source.url);
  assert.equal(archiveIdForRecipe(recipe), `example.com:${hash(sourceUrl).slice(0, 24)}`);
  assert.equal(archiveIdForRecipe({ ...recipe, name: "Renamed" }), archiveIdForRecipe(recipe));
  assert.notEqual(contentHashForRecipe({ ...recipe, name: "Renamed" }), contentHashForRecipe(recipe));
});

test("orders strings by Unicode code point", () => {
  assert.deepEqual(["\uE000", "\u{10000}", "A"].sort(compareUnicodeCodePoints), ["A", "\uE000", "\u{10000}"]);
});

test("publishes only finalized, passed normalized recipes", async () => {
  await withTemp(async (directory) => {
    const { manifest, outputDir } = await buildOne(directory);
    assert.equal(manifest.schema_version, "1.1.0");
    assert.equal(manifest.total_records, 1);
    const page = JSON.parse(await readFile(path.join(outputDir, "pages/page-00001.json"), "utf8"));
    assert.equal(page.recipes[0].review_status, "normalized-and-reviewed");
    assert.equal(page.recipes[0].source.url, "https://example.com/recipes/flatbread");
    assert.equal(page.recipes[0].normalization.model, "gpt-5.3-codex-spark");
    assert.deepEqual(page.recipes[0].ingredient_lines, ["1 cup flour", "0.5 cup water"]);
    await assert.doesNotReject(() => verifyBuiltFeed({
      manifestPath: path.join(outputDir, "manifest.json"), pagesDir: path.join(outputDir, "pages"),
    }));
  });
});

test("omits unnormalized, held, and source-less recipes", async () => {
  await withTemp(async (directory) => {
    const inputDir = path.join(directory, "input");
    const outputDir = path.join(directory, "output");
    const unnormalized = structuredClone(recipe); delete unnormalized.normalization;
    const held = structuredClone(recipe);
    held.source.url = "https://example.com/recipes/held";
    held.normalization.requires_review = true; held.normalization.source_review_status = "needs-review";
    const sourceLess = structuredClone(recipe); sourceLess.source = { name: "Original" };
    await writeRecipe(inputDir, "unnormalized.json", unnormalized);
    await writeRecipe(inputDir, "held.json", held);
    await writeRecipe(inputDir, "source-less.json", sourceLess);
    const manifest = await buildDailyDineFeed({
      inputDir, outputDir, releaseId: "empty", generatedAt: "2026-09-01T13:00:00.000Z", pageSize: 250,
    });
    assert.equal(manifest.total_records, 0);
    assert.equal(manifest.total_pages, 0);
  });
});

test("feed replacement is idempotent and preserves valid output on failure", async () => {
  await withTemp(async (directory) => {
    const first = await buildOne(directory);
    const manifestPath = path.join(first.outputDir, "manifest.json");
    const firstManifest = await readFile(manifestPath, "utf8");
    await buildDailyDineFeed({
      inputDir: path.join(directory, "input"), outputDir: first.outputDir, releaseId: "test-release",
      generatedAt: "2026-09-01T13:00:00.000Z", pageSize: 250,
    });
    assert.equal(await readFile(manifestPath, "utf8"), firstManifest);
    await writeRecipe(path.join(directory, "input"), "duplicate.json", { ...recipe, id: "duplicate", name: "Duplicate" });
    await assert.rejects(() => buildDailyDineFeed({
      inputDir: path.join(directory, "input"), outputDir: first.outputDir, releaseId: "test-release",
      generatedAt: "2026-09-01T13:00:00.000Z", pageSize: 250,
    }), /duplicate canonical source URL/i);
    assert.equal(await readFile(manifestPath, "utf8"), firstManifest);
  });
});

test("rejects a modified page", async () => {
  await withTemp(async (directory) => {
    const { outputDir } = await buildOne(directory);
    const pagePath = path.join(outputDir, "pages/page-00001.json");
    await writeFile(pagePath, `${await readFile(pagePath, "utf8")} `);
    await assert.rejects(() => verifyBuiltFeed({
      manifestPath: path.join(outputDir, "manifest.json"), pagesDir: path.join(outputDir, "pages"),
    }), /hash does not match/i);
  });
});
