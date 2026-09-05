import { access, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { missingCanonicalIngredientIds, planCanonicalIngredients } from "./canonical-ingredient-lib.mjs";
import { formatAjvErrors, jsonFiles, readJson, relative, root } from "./library.mjs";
import { normalizeHostname, publicationRightsIssues } from "./publication-review-lib.mjs";
import {
  materializeRecipe,
  normalizationProvenance,
  recipeFolder,
} from "./recipe-pipeline-lib.mjs";
import { stagedNormalizationIssues, stagedNormalizationRoot } from "./staged-normalization-lib.mjs";

const values = process.argv.slice(2);
function valueFor(flag, fallback) {
  const index = values.indexOf(flag);
  return index === -1 ? fallback : values[index + 1];
}

const planOnly = values.includes("--plan");
const rightsAttested = values.includes("--attest-publication-rights");
const site = valueFor("--site");
const runIdFilter = valueFor("--run-id");
const limitValue = valueFor("--limit");
const limit = limitValue === undefined ? Number.POSITIVE_INFINITY : Number(limitValue);
if (!Number.isInteger(limit) && limit !== Number.POSITIVE_INFINITY) throw new Error("--limit must be a positive integer");
if (limit < 1) throw new Error("--limit must be a positive integer");
if (!planOnly && !rightsAttested) {
  throw new Error("staged promotion requires --attest-publication-rights; the flag does not override the reviewed rights policy");
}

const rightsPolicyFile = path.resolve(root, valueFor("--rights-policy", "scraping/config/publication-rights.json"));
const recipeSchemaFile = path.join(root, "schemas", "recipe.schema.json");
const factsSchemaFile = path.join(root, "schemas", "recipe-facts.schema.json");
const generatedSchemaFile = path.join(root, "schemas", "generated-recipe.schema.json");
const ingredientSchemaFile = path.join(root, "schemas", "ingredient.schema.json");
const publicationReviewSchemaFile = path.join(root, "schemas", "publication-review.schema.json");
const [recipeSchema, factsSchema, generatedSchema, ingredientSchema, publicationReviewSchema, publicationRightsPolicy] = await Promise.all(
  [recipeSchemaFile, factsSchemaFile, generatedSchemaFile, ingredientSchemaFile, publicationReviewSchemaFile, rightsPolicyFile].map(readJson),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateRecipe = ajv.compile(recipeSchema);
const validateFacts = ajv.compile(factsSchema);
const validateGenerated = ajv.compile(generatedSchema);
const validateIngredient = ajv.compile(ingredientSchema);
const validatePublicationReview = ajv.compile(publicationReviewSchema);

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeJsonAtomically(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryFile, file);
}

function validationIssues(stage) {
  const issues = [];
  if (!validateFacts(stage.facts)) issues.push(`invalid staged facts: ${formatAjvErrors(validateFacts.errors)}`);
  if (!validateGenerated(stage.generated)) issues.push(`invalid staged generated recipe: ${formatAjvErrors(validateGenerated.errors)}`);
  if (!validateRecipe(stage.recipe)) issues.push(`invalid staged recipe: ${formatAjvErrors(validateRecipe.errors)}`);
  if (!validatePublicationReview(stage.publication_review)) {
    issues.push(`invalid staged publication review: ${formatAjvErrors(validatePublicationReview.errors)}`);
  }
  return issues;
}

let stagedEntries = await Promise.all((await jsonFiles(path.join(stagedNormalizationRoot, site ?? "")))
  .map(async (file) => ({ file, stage: await readJson(file) })));
if (runIdFilter) stagedEntries = stagedEntries.filter(({ stage }) => stage.run_id === runIdFilter);
stagedEntries = stagedEntries.slice(0, limit);
const recipeFiles = await jsonFiles(path.join(root, "recipes"));
const existingRecipes = await Promise.all(recipeFiles.map(readJson));
const existingIds = new Set(existingRecipes.map((recipe) => recipe.id));
const existingUrls = new Set(existingRecipes.map((recipe) => recipe.source?.url).filter(Boolean));
const canonicalIngredients = await Promise.all((await jsonFiles(path.join(root, "ingredients"))).map(readJson));
const projectedRecipes = [...existingRecipes];
const runSourceCounts = new Map();
const records = [];

for (const [index, { file: stagedFile, stage }] of stagedEntries.entries()) {
  const label = `${index + 1}/${stagedEntries.length} ${relative(stagedFile)}`;
  try {
    const candidateFile = path.resolve(root, stage.candidate_file ?? "");
    const candidateRoot = path.join(root, "scraping", "output") + path.sep;
    if (!candidateFile.startsWith(candidateRoot)) throw new Error("staged candidate path is outside scraping/output");
    const candidate = await readJson(candidateFile);
    const contentIssues = [...stagedNormalizationIssues(stage, candidate), ...validationIssues(stage)];
    if (contentIssues.length) {
      records.push({ staged_file: relative(stagedFile), candidate: relative(candidateFile), status: "needs-review", reasons: [...new Set(contentIssues)] });
      console.log(`Held ${label}: ${[...new Set(contentIssues)].join("; ")}`);
      continue;
    }

    if (existingUrls.has(candidate.source.url)) {
      records.push({ staged_file: relative(stagedFile), candidate: relative(candidateFile), status: "already-finalized" });
      console.log(`Skip ${label}: source already finalized`);
      continue;
    }

    const rightsIssues = publicationRightsIssues(candidate, publicationRightsPolicy, projectedRecipes, runSourceCounts);
    if (rightsIssues.length) {
      records.push({ staged_file: relative(stagedFile), candidate: relative(candidateFile), status: "publication-hold", reasons: rightsIssues });
      console.log(`Held ${label}: ${rightsIssues.join("; ")}`);
      continue;
    }

    const plannedIngredients = planCanonicalIngredients(stage.facts.ingredients, canonicalIngredients);
    for (const ingredient of plannedIngredients) {
      if (!validateIngredient(ingredient)) {
        throw new Error(`invalid inferred ingredient '${ingredient.id}': ${formatAjvErrors(validateIngredient.errors)}`);
      }
    }
    const recipe = materializeRecipe(
      candidate,
      stage.generated,
      existingIds,
      [...canonicalIngredients, ...plannedIngredients],
      stage.facts,
    );
    recipe.normalization = normalizationProvenance(candidate, recipe, stage.publication_review, {
      model: stage.model,
      promptVersion: stage.pipeline_version,
      transformedAt: stage.staged_at,
    });
    if (recipe.normalization.source_text_hash !== stage.recipe.normalization.source_text_hash
        || recipe.normalization.normalized_text_hash !== stage.recipe.normalization.normalized_text_hash) {
      throw new Error("rematerialized recipe hashes do not match the staged normalization");
    }
    if (!validateRecipe(recipe)) throw new Error(`invalid finalized recipe: ${formatAjvErrors(validateRecipe.errors)}`);
    const missingIngredientIds = missingCanonicalIngredientIds(recipe);
    if (missingIngredientIds.length) throw new Error(`canonical ingredient IDs are missing for: ${missingIngredientIds.join(", ")}`);

    const destination = path.join(root, "recipes", recipeFolder(recipe.meal_type), `${recipe.id}.json`);
    if (await exists(destination)) throw new Error(`recipe destination already exists: ${relative(destination)}`);
    if (!planOnly) {
      for (const ingredient of plannedIngredients) {
        const ingredientFile = path.join(root, "ingredients", `${ingredient.id}.json`);
        if (await exists(ingredientFile)) throw new Error(`canonical ingredient destination already exists: ${relative(ingredientFile)}`);
      }
      for (const ingredient of plannedIngredients) {
        await writeJsonAtomically(path.join(root, "ingredients", `${ingredient.id}.json`), ingredient);
        canonicalIngredients.push(ingredient);
      }
      await writeJsonAtomically(destination, recipe);
    } else {
      canonicalIngredients.push(...plannedIngredients);
    }
    existingIds.add(recipe.id);
    existingUrls.add(candidate.source.url);
    projectedRecipes.push(recipe);
    const hostname = normalizeHostname(candidate.source.url);
    runSourceCounts.set(hostname, (runSourceCounts.get(hostname) ?? 0) + 1);
    records.push({
      staged_file: relative(stagedFile), candidate: relative(candidateFile), recipe_id: recipe.id,
      status: planOnly ? "would-promote" : "promoted", destination: relative(destination),
      created_ingredients: plannedIngredients.map((ingredient) => ingredient.id),
    });
    console.log(`${planOnly ? "Would promote" : "Promoted"} ${recipe.id} from ${relative(stagedFile)}`);
  } catch (error) {
    records.push({ staged_file: relative(stagedFile), status: "failed", reasons: [error.message] });
    console.error(`Failed ${label}: ${error.message}`);
  }
}

const counts = Object.fromEntries([...new Set(records.map((record) => record.status))]
  .map((status) => [status, records.filter((record) => record.status === status).length]));
const analytics = {
  schema_version: "1.0.0",
  run_id: new Date().toISOString().replace(/[:.]/g, "-"),
  mode: planOnly ? "plan" : "promote-staged",
  rights_attested: rightsAttested,
  rights_policy: relative(rightsPolicyFile),
  selected_run_id: runIdFilter,
  total_staged: stagedEntries.length,
  counts,
  records,
};
if (planOnly) {
  console.log(JSON.stringify(analytics, null, 2));
} else {
  const analyticsFile = path.join(root, "work", "recipe-pipeline", "staged-promotion", analytics.run_id, "analytics.json");
  await writeJsonAtomically(analyticsFile, analytics);
  console.log(`Staged promotion complete: ${JSON.stringify(counts)}. Analytics: ${relative(analyticsFile)}`);
}
if (records.some((record) => record.status === "failed")) process.exitCode = 1;
