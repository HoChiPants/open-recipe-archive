import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { formatAjvErrors, jsonFiles, readJson, relative, root } from "./library.mjs";
import { normalizeHostname, publicationRightsIssues } from "./publication-review-lib.mjs";
import { recipeFolder } from "./recipe-pipeline-lib.mjs";
import { recipesStagingRoot, validateRecipesStaging } from "./recipes-staging-lib.mjs";

const values = process.argv.slice(2);
function valueFor(flag, fallback) {
  const index = values.indexOf(flag);
  return index === -1 ? fallback : values[index + 1];
}

const planOnly = values.includes("--plan") || values.includes("--dry-run");
const rightsAttested = values.includes("--attest-publication-rights");
const limitValue = valueFor("--limit");
const limit = limitValue === undefined ? Number.POSITIVE_INFINITY : Number(limitValue);
if ((!Number.isInteger(limit) && limit !== Number.POSITIVE_INFINITY) || limit < 1) throw new Error("--limit must be a positive integer");
if (!planOnly && !rightsAttested) throw new Error("staging promotion requires --attest-publication-rights; the flag does not override the reviewed rights policy");

const rightsPolicyFile = path.resolve(root, valueFor("--rights-policy", "scraping/config/publication-rights.json"));
const [rightsPolicy, rightsSchema] = await Promise.all([
  readJson(rightsPolicyFile),
  readJson(path.join(root, "schemas", "publication-rights.schema.json")),
]);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateRights = ajv.compile(rightsSchema);
if (!validateRights(rightsPolicy)) throw new Error(`invalid publication rights policy: ${formatAjvErrors(validateRights.errors)}`);

const staging = await validateRecipesStaging(recipesStagingRoot);
if (staging.absent) throw new Error("recipes-staging does not exist; run npm run recipes-staging:export first");
if (staging.errors.length) throw new Error(`recipes-staging is invalid:\n${staging.errors.map((item) => `- ${item}`).join("\n")}`);

async function exists(file) {
  try { await access(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
async function writeJsonAtomically(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

const finalRecipes = await Promise.all((await jsonFiles(path.join(root, "recipes"))).map(readJson));
const finalIngredients = await Promise.all((await jsonFiles(path.join(root, "ingredients"))).map(readJson));
const finalById = new Map(finalRecipes.map((recipe) => [recipe.id, recipe]));
const finalByUrl = new Map(finalRecipes.filter((recipe) => recipe.source?.url).map((recipe) => [recipe.source.url, recipe]));
const ingredientsById = new Map(finalIngredients.map((ingredient) => [ingredient.id, ingredient]));
const stagedIngredientsById = new Map(staging.ingredients.map(({ ingredient }) => [ingredient.id, ingredient]));
const projectedRecipes = [...finalRecipes];
const runSourceCounts = new Map();
const records = [];
const selected = staging.recipes.filter(({ recipe }) => {
  const finalized = finalByUrl.get(recipe.source.url);
  return !finalized || finalized.normalization?.normalized_text_hash !== recipe.normalization.normalized_text_hash;
}).slice(0, limit);

for (const { recipe } of selected) {
  const existingBySource = finalByUrl.get(recipe.source.url);
  if (existingBySource) {
    const identical = existingBySource.normalization?.normalized_text_hash === recipe.normalization.normalized_text_hash;
    records.push({ recipe_id: recipe.id, source_url: recipe.source.url, status: identical ? "already-promoted" : "conflict", reasons: identical ? [] : ["source URL is finalized with different normalized content"] });
    continue;
  }
  if (finalById.has(recipe.id)) {
    records.push({ recipe_id: recipe.id, source_url: recipe.source.url, status: "conflict", reasons: ["recipe id is already finalized for another source"] });
    continue;
  }
  const rightsIssues = publicationRightsIssues({ source: recipe.source }, rightsPolicy, projectedRecipes, runSourceCounts);
  if (rightsIssues.length) {
    records.push({ recipe_id: recipe.id, source_url: recipe.source.url, status: "publication-hold", reasons: rightsIssues });
    continue;
  }

  const ingredientsToWrite = [];
  const ingredientIssues = [];
  for (const usage of recipe.ingredients) {
    const finalized = ingredientsById.get(usage.ingredient_id);
    const staged = stagedIngredientsById.get(usage.ingredient_id);
    if (!finalized && !staged) ingredientIssues.push(`missing staged ingredient '${usage.ingredient_id}'`);
    if (finalized && staged && !isDeepStrictEqual(finalized, staged)) ingredientIssues.push(`staged ingredient '${usage.ingredient_id}' conflicts with finalized data`);
    if (!finalized && staged && !ingredientsToWrite.some((item) => item.id === staged.id)) ingredientsToWrite.push(staged);
  }
  if (ingredientIssues.length) {
    records.push({ recipe_id: recipe.id, source_url: recipe.source.url, status: "conflict", reasons: ingredientIssues });
    continue;
  }

  const destination = path.join(root, "recipes", recipeFolder(recipe.meal_type), `${recipe.id}.json`);
  if (!planOnly) {
    if (await exists(destination)) throw new Error(`unexpected recipe destination collision: ${relative(destination)}`);
    for (const ingredient of ingredientsToWrite) {
      const ingredientFile = path.join(root, "ingredients", `${ingredient.id}.json`);
      if (await exists(ingredientFile)) throw new Error(`unexpected ingredient destination collision: ${relative(ingredientFile)}`);
    }
    for (const ingredient of ingredientsToWrite) await writeJsonAtomically(path.join(root, "ingredients", `${ingredient.id}.json`), ingredient);
    await writeJsonAtomically(destination, recipe);
  }
  for (const ingredient of ingredientsToWrite) ingredientsById.set(ingredient.id, ingredient);
  finalById.set(recipe.id, recipe);
  finalByUrl.set(recipe.source.url, recipe);
  projectedRecipes.push(recipe);
  const hostname = normalizeHostname(recipe.source.url);
  runSourceCounts.set(hostname, (runSourceCounts.get(hostname) ?? 0) + 1);
  records.push({ recipe_id: recipe.id, source_url: recipe.source.url, status: planOnly ? "would-promote" : "promoted", destination: relative(destination), created_ingredients: ingredientsToWrite.map((item) => item.id) });
}

const counts = Object.fromEntries([...new Set(records.map((record) => record.status))].map((status) => [status, records.filter((record) => record.status === status).length]));
const analytics = {
  schema_version: "1.0.0",
  run_id: new Date().toISOString().replace(/[:.]/g, "-"),
  mode: planOnly ? "plan-recipes-staging" : "promote-recipes-staging",
  rights_attested: rightsAttested,
  rights_policy: relative(rightsPolicyFile),
  selected: selected.length,
  counts,
  records,
};
if (planOnly) {
  console.log(JSON.stringify(analytics, null, 2));
} else {
  const analyticsFile = path.join(root, "work", "recipe-pipeline", "recipes-staging-promotion", analytics.run_id, "analytics.json");
  await writeJsonAtomically(analyticsFile, analytics);
  console.log(`Staging promotion complete: ${JSON.stringify(counts)}. Analytics: ${relative(analyticsFile)}`);
}
if (records.some((record) => record.status === "conflict")) process.exitCode = 1;
