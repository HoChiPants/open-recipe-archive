import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { missingCanonicalIngredientIds, planCanonicalIngredients } from "./canonical-ingredient-lib.mjs";
import { formatAjvErrors, jsonFiles, readJson, relative, root } from "./library.mjs";
import { normalizeHostname } from "./publication-review-lib.mjs";
import { materializeRecipe, normalizationProvenance, recipeFolder } from "./recipe-pipeline-lib.mjs";
import { recipesStagingRoot, validateRecipesStaging } from "./recipes-staging-lib.mjs";
import { stagedNormalizationIssues, stagedNormalizationRoot } from "./staged-normalization-lib.mjs";

const values = process.argv.slice(2);
function valueFor(flag, fallback) {
  const index = values.indexOf(flag);
  return index === -1 ? fallback : values[index + 1];
}

const planOnly = values.includes("--plan") || values.includes("--dry-run");
const asOf = valueFor("--as-of", new Date().toISOString());
if (Number.isNaN(new Date(asOf).valueOf()) || !String(asOf).includes("T")) throw new Error("--as-of must be an ISO date-time");

const [recipeSchema, factsSchema, generatedSchema, ingredientSchema, publicationReviewSchema] = await Promise.all([
  "recipe.schema.json", "recipe-facts.schema.json", "generated-recipe.schema.json", "ingredient.schema.json", "publication-review.schema.json",
].map((name) => readJson(path.join(root, "schemas", name))));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateRecipe = ajv.compile(recipeSchema);
const validateFacts = ajv.compile(factsSchema);
const validateGenerated = ajv.compile(generatedSchema);
const validateIngredient = ajv.compile(ingredientSchema);
const validatePublicationReview = ajv.compile(publicationReviewSchema);

function stageValidationIssues(stage) {
  const issues = [];
  if (!validateFacts(stage.facts)) issues.push(`invalid staged facts: ${formatAjvErrors(validateFacts.errors)}`);
  if (!validateGenerated(stage.generated)) issues.push(`invalid staged generated recipe: ${formatAjvErrors(validateGenerated.errors)}`);
  if (!validatePublicationReview(stage.publication_review)) issues.push(`invalid staged publication review: ${formatAjvErrors(validatePublicationReview.errors)}`);
  return issues;
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

const existingRecipes = await Promise.all((await jsonFiles(path.join(root, "recipes"))).map(readJson));
const existingIds = new Set(existingRecipes.map((recipe) => recipe.id));
const existingUrls = new Set(existingRecipes.map((recipe) => recipe.source?.url).filter(Boolean));
const canonicalIngredients = await Promise.all((await jsonFiles(path.join(root, "ingredients"))).map(readJson));
const stagedFiles = await jsonFiles(stagedNormalizationRoot);
const outputRoot = path.join(root, `.recipes-staging-build-${process.pid}`);
const records = [];
const stagedSourceUrls = new Set();
const ingredientRecords = [];
const sourceCounts = new Map();
const skipped = { content_review: 0, already_finalized: 0, duplicate_source: 0, failed: 0 };

await rm(outputRoot, { recursive: true, force: true });
for (const [index, stagedFile] of stagedFiles.entries()) {
  if ((index + 1) % 250 === 0 || index === 0) console.log(`Preparing ${index + 1}/${stagedFiles.length}`);
  try {
    const stage = await readJson(stagedFile);
    const candidateFile = path.resolve(root, stage.candidate_file ?? "");
    const candidateRoot = path.join(root, "scraping", "output") + path.sep;
    if (!candidateFile.startsWith(candidateRoot)) throw new Error("staged candidate path is outside scraping/output");
    const candidate = await readJson(candidateFile);
    const issues = [...stagedNormalizationIssues(stage, candidate), ...stageValidationIssues(stage)];
    if (issues.length) {
      skipped.content_review += 1;
      continue;
    }
    if (existingUrls.has(candidate.source.url)) {
      skipped.already_finalized += 1;
      continue;
    }
    if (stagedSourceUrls.has(candidate.source.url)) {
      skipped.duplicate_source += 1;
      continue;
    }

    const plannedIngredients = planCanonicalIngredients(stage.facts.ingredients, canonicalIngredients);
    for (const ingredient of plannedIngredients) {
      if (!validateIngredient(ingredient)) throw new Error(`invalid inferred ingredient '${ingredient.id}': ${formatAjvErrors(validateIngredient.errors)}`);
    }
    const recipe = materializeRecipe(candidate, stage.generated, existingIds, [...canonicalIngredients, ...plannedIngredients], stage.facts);
    recipe.normalization = normalizationProvenance(candidate, recipe, stage.publication_review, {
      model: stage.model,
      promptVersion: stage.pipeline_version,
      transformedAt: stage.staged_at,
    });
    if (recipe.normalization.source_text_hash !== stage.recipe.normalization.source_text_hash
        || recipe.normalization.normalized_text_hash !== stage.recipe.normalization.normalized_text_hash) {
      throw new Error("rematerialized recipe hashes do not match the staged normalization");
    }
    if (!validateRecipe(recipe)) throw new Error(`invalid staging recipe: ${formatAjvErrors(validateRecipe.errors)}`);
    const missing = missingCanonicalIngredientIds(recipe);
    if (missing.length) throw new Error(`canonical ingredient IDs are missing for: ${missing.join(", ")}`);

    const recipeFile = path.join(recipeFolder(recipe.meal_type), `${recipe.id}.json`);
    await writeJson(path.join(outputRoot, recipeFile), recipe);
    for (const ingredient of plannedIngredients) {
      const ingredientFile = path.join("_ingredients", `${ingredient.id}.json`);
      await writeJson(path.join(outputRoot, ingredientFile), ingredient);
      ingredientRecords.push({ ingredient_id: ingredient.id, file: ingredientFile });
      canonicalIngredients.push(ingredient);
    }
    existingIds.add(recipe.id);
    stagedSourceUrls.add(candidate.source.url);
    const hostname = normalizeHostname(candidate.source.url);
    sourceCounts.set(hostname, (sourceCounts.get(hostname) ?? 0) + 1);
    records.push({
      recipe_id: recipe.id,
      file: recipeFile,
      source_name: recipe.source.name,
      source_url: recipe.source.url,
      source_text_hash: recipe.normalization.source_text_hash,
      normalized_text_hash: recipe.normalization.normalized_text_hash,
      model: recipe.normalization.model,
      prompt_version: recipe.normalization.prompt_version,
      transformed_at: recipe.normalization.transformed_at,
    });
  } catch (error) {
    skipped.failed += 1;
    console.error(`Failed ${relative(stagedFile)}: ${error.message}`);
  }
}

records.sort((left, right) => left.file.localeCompare(right.file));
ingredientRecords.sort((left, right) => left.file.localeCompare(right.file));
const manifest = {
  $schema: "../schemas/recipes-staging-manifest.schema.json",
  schema_version: "1.0.0",
  publication_status: "rights-pending",
  generated_at: new Date(asOf).toISOString(),
  total_recipes: records.length,
  total_ingredients: ingredientRecords.length,
  source_counts: Object.fromEntries([...sourceCounts.entries()].sort()),
  recipes: records,
  ingredients: ingredientRecords,
};
await writeJson(path.join(outputRoot, "manifest.json"), manifest);
await writeFile(path.join(outputRoot, "README.md"), `# Rights-pending recipe staging\n\nThis directory contains normalized, production-shaped recipe records for private review with source companies. **It is not an approved publication feed.** No file here represents a claim that Daily Dine has permission to publish the source recipe.\n\nThe recipes have passed the automated content-normalization checks, preserve source attribution and canonical URLs, and omit source images. They remain excluded from the public feed because the feed builder reads only \`recipes/\`.\n\nDo not copy these files into \`recipes/\` or a production database manually. After written permission or another valid publication basis is recorded in \`scraping/config/publication-rights.json\`, use \`npm run recipes-staging:promote -- --plan\` and then rerun it with \`--attest-publication-rights\`. The gate checks the recorded source-specific evidence before promotion.\n`);

const validation = await validateRecipesStaging(outputRoot);
if (validation.errors.length) {
  await rm(outputRoot, { recursive: true, force: true });
  throw new Error(`generated recipes-staging failed validation:\n${validation.errors.map((item) => `- ${item}`).join("\n")}`);
}
console.log(`Prepared ${records.length} rights-pending recipes and ${ingredientRecords.length} staged ingredients; skipped ${JSON.stringify(skipped)}.`);
if (planOnly) {
  await rm(outputRoot, { recursive: true, force: true });
  console.log("Dry run complete; recipes-staging was not changed.");
} else {
  const backup = path.join(root, `.recipes-staging-backup-${process.pid}`);
  await rm(backup, { recursive: true, force: true });
  try {
    await rename(recipesStagingRoot, backup);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await rename(outputRoot, recipesStagingRoot);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(recipesStagingRoot, { recursive: true, force: true });
    try { await rename(backup, recipesStagingRoot); } catch {}
    throw error;
  }
  console.log(`Wrote ${relative(recipesStagingRoot)}. It remains excluded from public feed generation.`);
}

if (skipped.failed) process.exitCode = 1;
