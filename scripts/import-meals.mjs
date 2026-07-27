import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { root } from "./library.mjs";

const values = process.argv.slice(2);
const option = (name) => {
  const index = values.indexOf(`--${name}`);
  return index === -1 ? undefined : values[index + 1];
};
const input = option("input");
const ids = new Set((option("ids") || "").split(",").map((id) => id.trim()).filter(Boolean));
const importAll = values.includes("--all");
const output = path.resolve(root, option("output") || "work/meals-import");

if (!input || (!importAll && ids.size === 0) || (importAll && ids.size > 0)) {
  console.error("Usage: npm run meals:import -- --input /path/to/recipes.json (--all | --ids id-1,id-2) [--output work/meals-import]");
  process.exit(1);
}

const slug = (value) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
const minutes = (value) => Number(String(value || "").match(/\d+/)?.[0] || 0);
const ingredientCategory = (name) => {
  const text = name.toLowerCase();
  if (/cheese|cream|milk|butter|yogurt|crème|crema/.test(text)) return "dairy";
  if (/chicken|beef|pork|steak|turkey|salmon|shrimp|fish|scallop|tofu|egg/.test(text)) return "protein";
  if (/rice|pasta|noodle|bread|baguette|tortilla|couscous|polenta|oat|barley|farro/.test(text)) return "grain";
  if (/bean|lentil|chickpea|edamame/.test(text)) return "legume";
  if (/oil/.test(text)) return "oil";
  if (/sugar|honey|syrup|jam|preserve/.test(text)) return "sweetener";
  if (/spice|pepper|salt|paprika|cumin|cinnamon|seasoning|powder/.test(text)) return "spice";
  if (/basil|parsley|thyme|mint|cilantro|rosemary|sage|oregano|chive/.test(text)) return "herb";
  if (/sauce|vinegar|mustard|mayo|ketchup|dressing|glaze|paste/.test(text)) return "condiment";
  return "produce";
};
const mealType = (recipe) => {
  const text = `${recipe.name} ${recipe.subName} ${(recipe.tags || []).join(" ")}`.toLowerCase();
  if (/salad|panzanella/.test(text)) return "salad";
  if (/soup|stew|chowder/.test(text)) return "soup";
  if (/sandwich|burger|taco|wrap/.test(text)) return "sandwich";
  if (/cake|cookie|dessert|cheesecake/.test(text)) return "dessert";
  if (/breakfast|waffle|pancake/.test(text)) return "breakfast";
  return "main";
};
const nutrition = (values = {}) => {
  const get = (key) => Number.parseFloat(values[key]?.amount);
  const result = { serving_size: "1 serving", source: "Imported factual data; verify before publishing" };
  for (const [source, target] of [["Calories", "calories"], ["Protein", "protein_g"], ["Carbohydrate", "carbohydrates_g"], ["Fat", "fat_g"], ["Dietary Fiber", "fiber_g"], ["Sugar", "sugar_g"], ["Sodium", "sodium_mg"]]) {
    const value = get(source);
    if (Number.isFinite(value)) result[target] = value;
  }
  return result;
};

const source = JSON.parse(await readFile(path.resolve(input), "utf8"));
const selected = importAll ? source : source.filter((recipe) => ids.has(recipe.id));
const missing = [...ids].filter((id) => !selected.some((recipe) => recipe.id === id));
if (missing.length) throw new Error(`Recipe IDs not found: ${missing.join(", ")}`);

const ingredientMap = new Map();
const recipeIds = new Set();
const recipes = selected.map((sourceRecipe) => {
  const type = mealType(sourceRecipe);
  const recipeIngredients = Object.entries(sourceRecipe.ingredients || {}).map(([name, value]) => {
    const ingredientId = slug(name.replace(/\*+$/, ""));
    if (!ingredientMap.has(ingredientId)) ingredientMap.set(ingredientId, {
      $schema: "../schemas/ingredient.schema.json", schema_version: "1.0.0", id: ingredientId,
      name: name.replace(/\*+$/, ""), categories: [ingredientCategory(name)], seasons: ["year-round"],
      ...(value.unit ? { default_unit: value.unit } : {}),
    });
    return { ingredient_id: ingredientId, item: name.replace(/\*+$/, ""), ...(value.amount && value.amount !== "unit" ? { quantity: value.amount } : {}), ...(value.unit ? { unit: value.unit } : {}) };
  });
  const fallbackId = slug(`legacy-recipe-${sourceRecipe.id || recipeIds.size + 1}`);
  const baseId = slug(sourceRecipe.name || "") || fallbackId;
  let id = baseId;
  if (recipeIds.has(id)) id = `${baseId.slice(0, 91)}-${slug(sourceRecipe.id || String(recipeIds.size + 1)).slice(-8)}`;
  while (recipeIds.has(id)) id = `${baseId.slice(0, 91)}-${recipeIds.size + 1}`;
  recipeIds.add(id);
  return {
    folder: type === "main" ? "mains" : `${type}s`,
    data: {
      $schema: "../../schemas/recipe.schema.json", schema_version: "1.0.0", id, name: sourceRecipe.name || `Legacy recipe ${sourceRecipe.id || recipeIds.size}`,
      ...(sourceRecipe.subName ? { subtitle: sourceRecipe.subName } : {}), meal_type: type,
      yield: { quantity: 2, unit: "servings" }, times: { prep_minutes: minutes(sourceRecipe.prepTime), cook_minutes: Math.max(0, minutes(sourceRecipe.totalTime) - minutes(sourceRecipe.prepTime)) },
      ingredients: recipeIngredients,
      instructions: [{ step: 1, text: "REWRITE REQUIRED: Describe the method in your own concise words before promotion." }],
      tags: [type, "needs-review"], nutrition: nutrition(sourceRecipe.nutritionalValues),
      source: { name: "HelloFresh", url: sourceRecipe.url, adapted: true },
      notes: ["Verify yield, timing, ingredient normalization, allergens, and nutrition before promotion."],
    },
  };
});

await mkdir(path.join(output, "recipes"), { recursive: true });
await mkdir(path.join(output, "ingredients"), { recursive: true });
for (const recipe of recipes) await writeFile(path.join(output, "recipes", `${recipe.data.id}.json`), `${JSON.stringify(recipe.data, null, 2)}\n`);
for (const ingredient of ingredientMap.values()) await writeFile(path.join(output, "ingredients", `${ingredient.id}.json`), `${JSON.stringify(ingredient, null, 2)}\n`);
await writeFile(path.join(output, "manifest.json"), `${JSON.stringify({ generated_at: new Date().toISOString(), source: path.resolve(input), recipe_count: recipes.length, ingredient_count: ingredientMap.size, destinations: Object.fromEntries(recipes.map((recipe) => [recipe.data.id, recipe.folder])), rights_attested: false }, null, 2)}\n`);
console.log(`Created review bundle with ${recipes.length} recipes and ${ingredientMap.size} ingredient candidates at ${path.relative(root, output)}.`);
console.log("Nothing was added to the public library. Rewrite and review every draft, then use meals:promote.");
