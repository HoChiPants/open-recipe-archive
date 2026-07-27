import { access, cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { readJson, root } from "./library.mjs";

const args = process.argv.slice(2);
const bundleIndex = args.indexOf("--bundle");
const bundle = path.resolve(root, bundleIndex === -1 ? "work/meals-import" : args[bundleIndex + 1]);
if (!args.includes("--attest-rights")) {
  console.error("Promotion requires --attest-rights, confirming you may dedicate these edited records under CC0.");
  process.exit(1);
}
const manifest = await readJson(path.join(bundle, "manifest.json"));
const recipeSchema = await readJson(path.join(root, "schemas/recipe.schema.json"));
const ingredientSchema = await readJson(path.join(root, "schemas/ingredient.schema.json"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateRecipe = ajv.compile(recipeSchema);
const validateIngredient = ajv.compile(ingredientSchema);
const recipeFiles = (await readdir(path.join(bundle, "recipes"))).filter((file) => file.endsWith(".json"));
const ingredientFiles = (await readdir(path.join(bundle, "ingredients"))).filter((file) => file.endsWith(".json"));

for (const file of recipeFiles) {
  const recipe = await readJson(path.join(bundle, "recipes", file));
  if (JSON.stringify(recipe).includes("REWRITE REQUIRED") || recipe.tags.includes("needs-review")) throw new Error(`${file} still needs editorial review`);
  if (!validateRecipe(recipe)) throw new Error(`${file} is invalid: ${ajv.errorsText(validateRecipe.errors)}`);
  const destination = path.join(root, "recipes", manifest.destinations[recipe.id], file);
  try { await access(destination); throw new Error(`${destination} already exists`); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
for (const file of ingredientFiles) {
  const ingredient = await readJson(path.join(bundle, "ingredients", file));
  if (!validateIngredient(ingredient)) throw new Error(`${file} is invalid: ${ajv.errorsText(validateIngredient.errors)}`);
}
for (const file of ingredientFiles) {
  const destination = path.join(root, "ingredients", file);
  try { await access(destination); } catch { await cp(path.join(bundle, "ingredients", file), destination); }
}
for (const file of recipeFiles) {
  const recipe = await readJson(path.join(bundle, "recipes", file));
  const folder = path.join(root, "recipes", manifest.destinations[recipe.id]);
  await mkdir(folder, { recursive: true });
  await cp(path.join(bundle, "recipes", file), path.join(folder, file));
}
console.log(`Promoted ${recipeFiles.length} reviewed recipes. Run npm run data:validate before committing.`);
