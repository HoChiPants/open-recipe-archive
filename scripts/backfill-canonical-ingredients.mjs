import { access, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { planCanonicalIngredients } from "./canonical-ingredient-lib.mjs";
import { buildIngredientIndex, normalizedLookup } from "./import-meals-lib.mjs";
import { formatAjvErrors, jsonFiles, readJson, relative, root } from "./library.mjs";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const [ingredientSchema, recipeSchema] = await Promise.all([
  readJson(path.join(root, "schemas", "ingredient.schema.json")),
  readJson(path.join(root, "schemas", "recipe.schema.json")),
]);
const validateIngredient = ajv.compile(ingredientSchema);
const validateRecipe = ajv.compile(recipeSchema);
const ingredientDirectory = path.join(root, "ingredients");
const ingredientFiles = await jsonFiles(ingredientDirectory);
const recipeFiles = await jsonFiles(path.join(root, "recipes"));
const canonicalIngredients = await Promise.all(ingredientFiles.map(readJson));
let createdCount = 0;
let updatedCount = 0;

for (const recipeFile of recipeFiles) {
  const recipe = JSON.parse(await readFile(recipeFile, "utf8"));
  const initialIndex = buildIngredientIndex(canonicalIngredients);
  const unlinkedIngredients = recipe.ingredients.filter((item) => !item.ingredient_id || !initialIndex.byId.has(item.ingredient_id));
  const planned = planCanonicalIngredients(unlinkedIngredients, canonicalIngredients);

  for (const ingredient of planned) {
    if (!validateIngredient(ingredient)) {
      throw new Error(`invalid inferred ingredient '${ingredient.id}': ${formatAjvErrors(validateIngredient.errors)}`);
    }
    const destination = path.join(ingredientDirectory, `${ingredient.id}.json`);
    try {
      await access(destination);
      throw new Error(`canonical ingredient destination already exists: ${relative(destination)}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  // Catalog records are deliberately persisted before recipes reference them.
  for (const ingredient of planned) {
    const destination = path.join(ingredientDirectory, `${ingredient.id}.json`);
    await writeFile(destination, `${JSON.stringify(ingredient, null, 2)}\n`);
    canonicalIngredients.push(ingredient);
    createdCount += 1;
  }

  const { lookup, byId } = buildIngredientIndex(canonicalIngredients);
  let changed = false;
  for (const item of recipe.ingredients) {
    const ingredientId = item.ingredient_id && byId.has(item.ingredient_id)
      ? item.ingredient_id
      : lookup.get(normalizedLookup(item.item))?.id;
    if (!ingredientId) throw new Error(`${relative(recipeFile)}: no canonical ID for '${item.item}'`);
    if (item.ingredient_id !== ingredientId) {
      item.ingredient_id = ingredientId;
      changed = true;
    }
  }
  if (!validateRecipe(recipe)) throw new Error(`${relative(recipeFile)}: ${formatAjvErrors(validateRecipe.errors)}`);

  if (changed) {
    const temporaryFile = `${recipeFile}.tmp`;
    await writeFile(temporaryFile, `${JSON.stringify(recipe, null, 2)}\n`);
    await rename(temporaryFile, recipeFile);
    updatedCount += 1;
  }
}

console.log(`Canonical ingredient backfill complete: ${createdCount} ingredients created, ${updatedCount} recipes updated.`);
