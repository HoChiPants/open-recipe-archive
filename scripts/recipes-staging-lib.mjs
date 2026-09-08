import { access } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { formatAjvErrors, jsonFiles, readJson, root } from "./library.mjs";
import { normalizedTextHash } from "./recipe-pipeline-lib.mjs";

export const recipesStagingRoot = path.join(root, "recipes-staging");

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function safeManifestPath(directory, relativeFile) {
  const resolved = path.resolve(directory, relativeFile);
  const prefix = path.resolve(directory) + path.sep;
  if (!resolved.startsWith(prefix)) throw new Error(`manifest path escapes recipes-staging: ${relativeFile}`);
  return resolved;
}

export async function validateRecipesStaging(directory = recipesStagingRoot) {
  if (!(await exists(directory))) return { absent: true, errors: [], recipes: [], ingredients: [] };

  const [manifestSchema, recipeSchema, ingredientSchema] = await Promise.all([
    readJson(path.join(root, "schemas", "recipes-staging-manifest.schema.json")),
    readJson(path.join(root, "schemas", "recipe.schema.json")),
    readJson(path.join(root, "schemas", "ingredient.schema.json")),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: false, formats: { "date-time": true } });
  const validateManifest = ajv.compile(manifestSchema);
  const validateRecipe = ajv.compile(recipeSchema);
  const validateIngredient = ajv.compile(ingredientSchema);
  const errors = [];
  const manifestFile = path.join(directory, "manifest.json");
  if (!(await exists(manifestFile))) return { absent: false, errors: ["recipes-staging/manifest.json is missing"], recipes: [], ingredients: [] };

  let manifest;
  try {
    manifest = await readJson(manifestFile);
  } catch (error) {
    return { absent: false, errors: [`recipes-staging/manifest.json: ${error.message}`], recipes: [], ingredients: [] };
  }
  if (!validateManifest(manifest)) errors.push(`recipes-staging/manifest.json: ${formatAjvErrors(validateManifest.errors)}`);
  if (manifest.publication_status !== "rights-pending") errors.push("recipes-staging/manifest.json: publication_status must remain rights-pending");

  const finalIngredientFiles = await jsonFiles(path.join(root, "ingredients"));
  const finalIngredients = await Promise.all(finalIngredientFiles.map(readJson));
  const finalIngredientsById = new Map(finalIngredients.map((item) => [item.id, item]));
  const ingredientIds = new Set(finalIngredientsById.keys());
  const ingredients = [];
  const stagedIngredientIds = new Set();
  const listedIngredientFiles = new Set();
  for (const entry of manifest.ingredients ?? []) {
    try {
      const file = safeManifestPath(directory, entry.file);
      listedIngredientFiles.add(path.resolve(file));
      const ingredient = await readJson(file);
      ingredients.push({ file, ingredient });
      if (!validateIngredient(ingredient)) errors.push(`${entry.file}: ${formatAjvErrors(validateIngredient.errors)}`);
      if (ingredient.id !== entry.ingredient_id) errors.push(`${entry.file}: ingredient id does not match manifest`);
      if (stagedIngredientIds.has(ingredient.id)) errors.push(`${entry.file}: duplicate staged ingredient id '${ingredient.id}'`);
      const finalized = finalIngredientsById.get(ingredient.id);
      if (finalized && !isDeepStrictEqual(finalized, ingredient)) errors.push(`${entry.file}: conflicts with finalized ingredient '${ingredient.id}'`);
      stagedIngredientIds.add(ingredient.id);
      ingredientIds.add(ingredient.id);
    } catch (error) {
      errors.push(`${entry.file}: ${error.message}`);
    }
  }

  const recipes = [];
  const recipeIds = new Set();
  const sourceUrls = new Set();
  const listedRecipeFiles = new Set();
  for (const entry of manifest.recipes ?? []) {
    try {
      const file = safeManifestPath(directory, entry.file);
      listedRecipeFiles.add(path.resolve(file));
      const recipe = await readJson(file);
      recipes.push({ file, recipe, entry });
      if (!validateRecipe(recipe)) errors.push(`${entry.file}: ${formatAjvErrors(validateRecipe.errors)}`);
      if (recipe.id !== entry.recipe_id) errors.push(`${entry.file}: recipe id does not match manifest`);
      if (recipeIds.has(recipe.id)) errors.push(`${entry.file}: duplicate recipe id '${recipe.id}'`);
      recipeIds.add(recipe.id);
      if (!recipe.source?.url || recipe.source.url !== entry.source_url) errors.push(`${entry.file}: source URL does not match manifest`);
      if (recipe.source?.name !== entry.source_name) errors.push(`${entry.file}: source name does not match manifest`);
      if (recipe.source?.adapted !== true) errors.push(`${entry.file}: source.adapted must be true`);
      if (sourceUrls.has(recipe.source?.url)) errors.push(`${entry.file}: duplicate source URL '${recipe.source?.url}'`);
      if (recipe.source?.url) sourceUrls.add(recipe.source.url);
      const provenance = recipe.normalization;
      if (!provenance) {
        errors.push(`${entry.file}: normalization provenance is missing`);
      } else {
        if (provenance.requires_review !== false || provenance.source_review_status !== "passed") {
          errors.push(`${entry.file}: normalization must have passed content review`);
        }
        if (normalizedTextHash(recipe) !== provenance.normalized_text_hash) errors.push(`${entry.file}: normalized text hash does not match`);
        for (const [field, manifestField] of [["source_text_hash", "source_text_hash"], ["normalized_text_hash", "normalized_text_hash"], ["model", "model"], ["prompt_version", "prompt_version"], ["transformed_at", "transformed_at"]]) {
          if (provenance[field] !== entry[manifestField]) errors.push(`${entry.file}: normalization.${field} does not match manifest`);
        }
      }
      for (const ingredient of recipe.ingredients ?? []) {
        if (!ingredientIds.has(ingredient.ingredient_id)) errors.push(`${entry.file}: unknown ingredient_id '${ingredient.ingredient_id}'`);
      }
    } catch (error) {
      errors.push(`${entry.file}: ${error.message}`);
    }
  }

  const allFiles = await jsonFiles(directory);
  const actualRecipeFiles = allFiles.filter((file) => file !== manifestFile && !file.startsWith(path.join(directory, "_ingredients") + path.sep));
  const actualIngredientFiles = allFiles.filter((file) => file.startsWith(path.join(directory, "_ingredients") + path.sep));
  for (const file of actualRecipeFiles) if (!listedRecipeFiles.has(path.resolve(file))) errors.push(`${path.relative(directory, file)}: recipe is not listed in manifest`);
  for (const file of actualIngredientFiles) if (!listedIngredientFiles.has(path.resolve(file))) errors.push(`${path.relative(directory, file)}: ingredient is not listed in manifest`);
  if ((manifest.recipes?.length ?? 0) !== actualRecipeFiles.length || manifest.total_recipes !== actualRecipeFiles.length) errors.push("recipes-staging/manifest.json: recipe totals do not match files");
  if ((manifest.ingredients?.length ?? 0) !== actualIngredientFiles.length || manifest.total_ingredients !== actualIngredientFiles.length) errors.push("recipes-staging/manifest.json: ingredient totals do not match files");

  const countedSources = Object.fromEntries([...sourceUrls].map((url) => new URL(url).hostname.replace(/^www\./, "")).reduce((counts, host) => counts.set(host, (counts.get(host) ?? 0) + 1), new Map()));
  if (JSON.stringify(Object.fromEntries(Object.entries(manifest.source_counts ?? {}).sort())) !== JSON.stringify(Object.fromEntries(Object.entries(countedSources).sort()))) {
    errors.push("recipes-staging/manifest.json: source_counts do not match recipes");
  }
  return { absent: false, errors: [...new Set(errors)], manifest, recipes, ingredients };
}
