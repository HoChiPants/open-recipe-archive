import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { normalizedTextHash } from "../scripts/recipe-pipeline-lib.mjs";
import { validateRecipesStaging } from "../scripts/recipes-staging-lib.mjs";

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const recipe = {
    $schema: "../../schemas/recipe.schema.json",
    schema_version: "1.0.0",
    id: "staged-salad-test",
    name: "Staged Salad Test",
    meal_type: "salad",
    yield: { quantity: 2, unit: "servings" },
    times: { prep_minutes: 5, cook_minutes: 0 },
    ingredients: [{ ingredient_id: "staged-test-leaf", item: "Staged test leaf", quantity: 2 }],
    instructions: [{ step: 1, text: "Toss the leaves together." }],
    tags: ["salad"],
    source: { name: "Example", url: "https://example.test/staged-salad", adapted: true },
    normalization: {
      source_text_hash: "a".repeat(64),
      normalized_text_hash: "",
      model: "gpt-test",
      model_version: "gpt-test",
      prompt_version: "3.0.0",
      transformed_at: "2026-09-01T00:00:00.000Z",
      semantic_similarity: 20,
      structural_similarity: 20,
      requires_review: false,
      source_review_status: "passed",
    },
    created_at: "2026-09-01",
    updated_at: "2026-09-01",
  };
  recipe.normalization.normalized_text_hash = normalizedTextHash(recipe);
  const ingredient = {
    $schema: "../schemas/ingredient.schema.json",
    schema_version: "1.0.0",
    id: "staged-test-leaf",
    name: "Staged test leaf",
    categories: ["produce"],
    seasons: ["year-round"],
  };
  const entry = {
    recipe_id: recipe.id,
    file: `salads/${recipe.id}.json`,
    source_name: recipe.source.name,
    source_url: recipe.source.url,
    source_text_hash: recipe.normalization.source_text_hash,
    normalized_text_hash: recipe.normalization.normalized_text_hash,
    model: recipe.normalization.model,
    prompt_version: recipe.normalization.prompt_version,
    transformed_at: recipe.normalization.transformed_at,
  };
  const manifest = {
    $schema: "../schemas/recipes-staging-manifest.schema.json",
    schema_version: "1.0.0",
    publication_status: "rights-pending",
    generated_at: "2026-09-01T00:00:00.000Z",
    total_recipes: 1,
    total_ingredients: 1,
    source_counts: { "example.test": 1 },
    recipes: [entry],
    ingredients: [{ ingredient_id: ingredient.id, file: `_ingredients/${ingredient.id}.json` }],
  };
  return { recipe, ingredient, manifest };
}

async function withStagingFixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "recipes-staging-test-"));
  const values = fixture();
  await writeJson(path.join(directory, values.manifest.recipes[0].file), values.recipe);
  await writeJson(path.join(directory, values.manifest.ingredients[0].file), values.ingredient);
  await writeJson(path.join(directory, "manifest.json"), values.manifest);
  try { await run(directory, values); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("accepts production-shaped recipes that remain rights-pending in the manifest", async () => {
  await withStagingFixture(async (directory) => {
    const result = await validateRecipesStaging(directory);
    assert.deepEqual(result.errors, []);
    assert.equal(result.recipes.length, 1);
  });
});

test("rejects review-required and hash-modified staging recipes", async () => {
  await withStagingFixture(async (directory, values) => {
    values.recipe.normalization.requires_review = true;
    values.recipe.instructions[0].text = "Copied or changed after hashing.";
    await writeJson(path.join(directory, values.manifest.recipes[0].file), values.recipe);
    const result = await validateRecipesStaging(directory);
    assert.ok(result.errors.some((error) => error.includes("passed content review")));
    assert.ok(result.errors.some((error) => error.includes("normalized text hash")));
  });
});

test("rejects manifests that claim a publishable status", async () => {
  await withStagingFixture(async (directory, values) => {
    values.manifest.publication_status = "approved";
    await writeJson(path.join(directory, "manifest.json"), values.manifest);
    const result = await validateRecipesStaging(directory);
    assert.ok(result.errors.some((error) => error.includes("rights-pending")));
  });
});
