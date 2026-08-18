import { access, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { jsonFiles, readJson, root } from "./library.mjs";
import { transformMeals } from "./import-meals-lib.mjs";

const values = process.argv.slice(2);
const option = (name) => {
  const index = values.indexOf(`--${name}`);
  return index === -1 ? undefined : values[index + 1];
};
const input = option("input");
const ids = new Set((option("ids") || "").split(",").map((id) => id.trim()).filter(Boolean));
const importAll = values.includes("--all");
const clean = values.includes("--clean");
const output = path.resolve(root, option("output") || "work/meals-import");
const workRoot = path.resolve(root, "work");
const outputRelativeToWork = path.relative(workRoot, output);
const bundleKind = "open-recipe-archive-meals-import-review";
const hemisphere = option("hemisphere") || "northern";
const asOf = option("as-of") || new Date().toISOString();

if (!input || (!importAll && ids.size === 0) || (importAll && ids.size > 0)) {
  console.error("Usage: npm run meals:import -- --input /path/to/recipes.json (--all | --ids id-1,id-2) [--hemisphere northern|southern] [--output work/meals-import] [--clean] [--as-of ISO_DATE]");
  process.exit(1);
}
if (!new Set(["northern", "southern"]).has(hemisphere)) throw new Error("--hemisphere must be 'northern' or 'southern'.");
if (!outputRelativeToWork || outputRelativeToWork.startsWith(`..${path.sep}`) || path.isAbsolute(outputRelativeToWork)) {
  throw new Error("--output must be a dedicated directory below this project's work/ directory.");
}
await mkdir(workRoot, { recursive: true });
const realRoot = await realpath(root);
const realWorkRoot = await realpath(workRoot);
const realWorkRelativeToRoot = path.relative(realRoot, realWorkRoot);
if (!realWorkRelativeToRoot || realWorkRelativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(realWorkRelativeToRoot)) {
  throw new Error("The project's work/ directory must not resolve outside the repository.");
}
const assertPhysicalWorkPath = async (target, { allowWorkRoot = true } = {}) => {
  let existing = target;
  while (true) {
    try {
      const resolved = await realpath(existing);
      const relative = path.relative(realWorkRoot, resolved);
      if ((!allowWorkRoot && !relative) || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Refusing path '${target}' because it resolves outside the dedicated work/ tree.`);
      }
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
};
await assertPhysicalWorkPath(path.dirname(output));
const generatedAt = new Date(asOf);
if (Number.isNaN(generatedAt.valueOf())) throw new Error(`Invalid --as-of value '${asOf}'.`);

const inputPath = path.resolve(input);
const source = JSON.parse(await readFile(inputPath, "utf8"));
if (!Array.isArray(source)) throw new TypeError("Input must be a top-level JSON array.");
const duplicateSourceIds = source.map((recipe) => recipe.id).filter((id, index, all) => !id || all.indexOf(id) !== index);
if (duplicateSourceIds.length) throw new Error(`Every source recipe needs a unique id; invalid ids: ${[...new Set(duplicateSourceIds)].slice(0, 20).join(", ")}`);

const selected = importAll ? source : source.filter((recipe) => ids.has(recipe.id));
const missing = [...ids].filter((id) => !selected.some((recipe) => recipe.id === id));
if (missing.length) throw new Error(`Recipe IDs not found: ${missing.join(", ")}`);
if (!selected.length) throw new Error("No recipes were selected.");

const existingIngredientFiles = await jsonFiles(path.join(root, "ingredients"));
const existingIngredients = await Promise.all(existingIngredientFiles.map(readJson));
const transformed = transformMeals({ selectedRecipes: selected, allRecipes: source, existingIngredients, hemisphere });

const recipeSchema = await readJson(path.join(root, "schemas/recipe.schema.json"));
const ingredientSchema = await readJson(path.join(root, "schemas/ingredient.schema.json"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateRecipe = ajv.compile(recipeSchema);
const validateIngredient = ajv.compile(ingredientSchema);
const validationErrors = [];
for (const ingredient of transformed.ingredients) {
  if (!validateIngredient(ingredient)) validationErrors.push(`ingredient ${ingredient.id}: ${ajv.errorsText(validateIngredient.errors)}`);
}
const availableIngredientIds = new Set([...existingIngredients, ...transformed.ingredients].map((ingredient) => ingredient.id));
for (const { data: recipe } of transformed.recipes) {
  if (!validateRecipe(recipe)) validationErrors.push(`recipe ${recipe.id}: ${ajv.errorsText(validateRecipe.errors)}`);
  for (const line of recipe.ingredients) {
    if (!availableIngredientIds.has(line.ingredient_id)) validationErrors.push(`recipe ${recipe.id}: unknown ingredient_id '${line.ingredient_id}'`);
  }
}
if (validationErrors.length) throw new Error(`Generated bundle is invalid:\n${validationErrors.slice(0, 50).map((error) => `- ${error}`).join("\n")}`);

let outputExists = false;
try {
  await access(output);
  if (!clean) throw new Error(`Output already exists at ${output}; pass --clean to replace this importer-owned review bundle.`);
  const previousManifest = await readJson(path.join(output, "manifest.json")).catch(() => undefined);
  if (previousManifest?.bundle_kind !== bundleKind || previousManifest?.review_required !== true || previousManifest?.rights_attested !== false) {
    throw new Error(`Refusing to clean ${output} because it is not an importer-owned review bundle.`);
  }
  await assertPhysicalWorkPath(output, { allowWorkRoot: false });
  outputExists = true;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

await mkdir(path.dirname(output), { recursive: true });
const temporary = await mkdtemp(path.join(path.dirname(output), ".meals-import-"));
const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const writeInBatches = async (entries, writer, size = 200) => {
  for (let index = 0; index < entries.length; index += size) await Promise.all(entries.slice(index, index + size).map(writer));
};

try {
  await mkdir(path.join(temporary, "recipes"), { recursive: true });
  await mkdir(path.join(temporary, "ingredients"), { recursive: true });
  await writeInBatches(transformed.recipes, ({ data }) => writeJson(path.join(temporary, "recipes", `${data.id}.json`), data));
  await writeInBatches(transformed.ingredients, (ingredient) => writeJson(path.join(temporary, "ingredients", `${ingredient.id}.json`), ingredient));

  const auditCounts = Object.fromEntries(Object.entries(transformed.audit).map(([key, entries]) => [key, entries.length]));
  const manifest = {
    bundle_kind: bundleKind,
    schema_version: "1.0.0",
    generated_at: generatedAt.toISOString(),
    source: inputPath,
    hemisphere,
    recipe_count: transformed.recipes.length,
    ingredient_candidate_count: transformed.ingredients.length,
    existing_ingredient_count: existingIngredients.length,
    source_instruction_count: selected.reduce((sum, recipe) => sum + (recipe.instructions?.length ?? 0), 0),
    destinations: transformed.destinations,
    audit_counts: auditCounts,
    review_required: true,
    rights_attested: false,
    instructions: "Source directions are not copied into drafts. Replace every REWRITE REQUIRED step with original concise directions and review inferred metadata before promotion.",
  };
  await writeJson(path.join(temporary, "manifest.json"), manifest);
  await writeJson(path.join(temporary, "audit.json"), transformed.audit);
  if (outputExists) {
    await assertPhysicalWorkPath(output, { allowWorkRoot: false });
    await rm(output, { recursive: true, force: true });
  }
  await rename(temporary, output);
  console.log(`Created validated review bundle with ${manifest.recipe_count} recipes and ${manifest.ingredient_candidate_count} ingredient candidates at ${path.relative(root, output)}.`);
  console.log(`Season model: ${hemisphere}. Detailed inference and source-data issues are in ${path.relative(root, path.join(output, "audit.json"))}.`);
  console.log("Nothing was added to the public library. Rewrite and review every draft, then use meals:promote only if you can attest the required rights.");
} catch (error) {
  await rm(temporary, { recursive: true, force: true });
  throw error;
}
