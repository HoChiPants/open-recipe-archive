import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { formatAjvErrors, jsonFiles, readJson, relative, root } from "./library.mjs";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const recipeSchema = await readJson(path.join(root, "schemas/recipe.schema.json"));
const ingredientSchema = await readJson(path.join(root, "schemas/ingredient.schema.json"));
const validateRecipe = ajv.compile(recipeSchema);
const validateIngredient = ajv.compile(ingredientSchema);
const recipeFiles = await jsonFiles(path.join(root, "recipes"));
const ingredientFiles = await jsonFiles(path.join(root, "ingredients"));
const errors = [];
const recipeIds = new Map();
const ingredientIds = new Map();
const ingredients = [];

for (const file of ingredientFiles) {
  const ingredient = await readJson(file);
  ingredients.push({ file, ingredient });
  if (!validateIngredient(ingredient)) {
    errors.push(`${relative(file)}: ${formatAjvErrors(validateIngredient.errors)}`);
  }
  if (ingredientIds.has(ingredient.id)) {
    errors.push(`${relative(file)}: duplicate ingredient id '${ingredient.id}'`);
  }
  ingredientIds.set(ingredient.id, file);
}

for (const file of recipeFiles) {
  const recipe = await readJson(file);
  if (!validateRecipe(recipe)) {
    errors.push(`${relative(file)}: ${formatAjvErrors(validateRecipe.errors)}`);
  }
  if (recipeIds.has(recipe.id)) errors.push(`${relative(file)}: duplicate recipe id '${recipe.id}'`);
  recipeIds.set(recipe.id, file);

  const expectedSteps = recipe.instructions?.map((_, index) => index + 1) ?? [];
  const actualSteps = recipe.instructions?.map((instruction) => instruction.step) ?? [];
  if (JSON.stringify(expectedSteps) !== JSON.stringify(actualSteps)) {
    errors.push(`${relative(file)}: instruction steps must be sequential and begin at 1`);
  }

  for (const item of recipe.ingredients ?? []) {
    if (item.ingredient_id && !ingredientIds.has(item.ingredient_id)) {
      errors.push(`${relative(file)}: unknown ingredient_id '${item.ingredient_id}'`);
    }
  }
}

if (errors.length) {
  console.error(`Validation failed with ${errors.length} issue${errors.length === 1 ? "" : "s"}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Valid: ${recipeFiles.length} recipes and ${ingredients.length} ingredients.`);
