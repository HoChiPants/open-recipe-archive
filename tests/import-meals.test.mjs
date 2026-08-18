import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  buildIngredientIndex,
  buildRecipeIdMap,
  inferIngredientCategory,
  inferIngredientAllergens,
  inferIngredientSeasons,
  inferMealType,
  inferYield,
  normalizeQuantity,
  parseMinutes,
  transformMeals,
} from "../scripts/import-meals-lib.mjs";

test("duration and measurement normalization preserves useful values", () => {
  assert.equal(parseMinutes("1 hour 5 minutes"), 65);
  assert.equal(parseMinutes("2 hours 45 minutes"), 165);
  assert.equal(parseMinutes("4 hrs 15 min"), 255);
  assert.equal(parseMinutes("30 minutes"), 30);
  assert.equal(parseMinutes(""), undefined);

  assert.deepEqual(normalizeQuantity("2", "ounces"), { quantity: 2, unit: "ounce" });
  assert.deepEqual(normalizeQuantity("1/2", "cup"), { quantity: "1/2", unit: "cup" });
  assert.deepEqual(normalizeQuantity("1 1/2", "cups"), { quantity: 1.5, unit: "cup" });
  assert.deepEqual(normalizeQuantity("", ""), { missing: true });
  assert.deepEqual(normalizeQuantity("2", ""), { quantity: 2, missingUnit: true });
  assert.deepEqual(normalizeQuantity("unit", ""), { malformed: true });
  assert.deepEqual(inferYield({ subName: "Platter | 2-4 Servings", tags: [] }), { quantity: 4, unit: "servings", inferred: true, reason: "source range" });
});

test("ingredient classification and Northern Hemisphere peaks are deterministic", () => {
  assert.equal(inferIngredientCategory("Fresh Mozzarella"), "dairy");
  assert.equal(inferIngredientCategory("Coconut Milk"), "other");
  assert.equal(inferIngredientCategory("Bold & Savory Steak Spice"), "spice");
  assert.equal(inferIngredientCategory("Eggplant"), "produce");
  assert.deepEqual(inferIngredientAllergens("Eggplant"), []);
  assert.deepEqual(inferIngredientAllergens("Corn Flour"), []);
  assert.deepEqual(inferIngredientAllergens("Rice Flour"), []);
  assert.deepEqual(inferIngredientAllergens("Rice Noodles"), []);
  assert.deepEqual(inferIngredientAllergens("All-Purpose Flour"), ["wheat"]);
  assert.deepEqual(inferIngredientAllergens("Egg"), ["eggs"]);
  assert.equal(inferIngredientCategory("Yukon Gold Potatoes"), "produce");
  assert.equal(inferIngredientCategory("Potato Buns"), "grain");
  assert.deepEqual(inferIngredientSeasons("Asparagus", "produce"), ["spring"]);
  assert.deepEqual(inferIngredientSeasons("Tomatoes", "produce"), ["summer", "fall"]);
  assert.deepEqual(inferIngredientSeasons("Dried Cranberries", "produce"), ["year-round"]);
  assert.throws(() => buildIngredientIndex([
    { id: "first", name: "First", aliases: ["shared"] },
    { id: "second", name: "Second", aliases: ["shared"] },
  ]), /Ambiguous canonical ingredient alias/);
});

test("meal type inference follows the leading dish instead of listed sides", () => {
  assert.equal(inferMealType({ name: "Crispy Parmesan Chicken with Apple Crisp" }), "main");
  assert.equal(inferMealType({ name: "Prosciutto-Wrapped Chicken" }), "main");
  assert.equal(inferMealType({ name: "Beef & Mushroom Shepherd’s Pie" }), "main");
  assert.equal(inferMealType({ name: "Bavette Steak & Sherry Shallot Sauce" }), "main");
  assert.equal(inferMealType({ name: "Nectarine and Zucchini Panzanella" }), "salad");
  assert.equal(inferMealType({ name: "Sweet Thai Chili Steak" }), "main");
  assert.equal(inferMealType({ name: "Chopped Chicken Caesar Salad Sandwiches" }), "sandwich");
  assert.equal(inferMealType({ name: "Country Chicken Honey Butter Biscuits" }), "main");
  assert.equal(inferMealType({ name: "Homestyle Beef & Biscuit Pot Pie" }), "main");
  assert.equal(inferMealType({ name: "White Bean Chili" }), "soup");
});

test("duplicate-title recipe IDs are stable across order and selection", () => {
  const recipes = [
    { id: "aaaaaaaa11111111", name: "Same Recipe" },
    { id: "bbbbbbbb22222222", name: "Same Recipe" },
    { id: "cccccccc33333333", name: "Unique Recipe" },
  ];
  const forward = buildRecipeIdMap(recipes);
  const reversed = buildRecipeIdMap([...recipes].reverse());
  assert.deepEqual([...forward.entries()].sort(), [...reversed.entries()].sort());
  assert.equal(forward.get("aaaaaaaa11111111"), "same-recipe-11111111");
  assert.equal(forward.get("bbbbbbbb22222222"), "same-recipe-22222222");
  assert.equal(forward.get("cccccccc33333333"), "unique-recipe");
  assert.equal(new Set(forward.values()).size, recipes.length);
  assert.ok([...forward.values()].every((id) => id.length <= 100));
});

const existingIngredient = (id, name, seasons, allergens = []) => ({ id, name, aliases: [], seasons, allergens });
const existingIngredients = [
  existingIngredient("tomato", "Tomato", ["summer", "fall"]),
  existingIngredient("lentil", "Lentil", ["year-round"]),
  existingIngredient("strawberry", "Strawberry", ["spring", "summer"]),
  existingIngredient("banana", "Banana", ["year-round"]),
  existingIngredient("butter", "Butter", ["year-round"], ["milk"]),
];

const sourceRecipe = (overrides) => ({
  id: overrides.id,
  name: overrides.name,
  subName: overrides.subName ?? "",
  url: `https://www.hellofresh.com/recipes/${overrides.id}`,
  totalTime: overrides.totalTime ?? "30 minutes",
  prepTime: overrides.prepTime ?? "10 minutes",
  difficulty: overrides.difficulty ?? "Easy",
  tags: overrides.tags ?? [],
  nutritionalValues: overrides.nutritionalValues ?? {},
  ingredients: overrides.ingredients,
  instructions: overrides.instructions ?? [{ order: 1, text: "Cook until done.", image: "" }],
});

test("full transformation validates relationships, seasons, fallbacks, and review guards", async () => {
  const source = [
    sourceRecipe({ id: "summer-salad", name: "Summer Tomato Salad", tags: ["Veggie", "Gluten-free"], ingredients: { Tomato: { amount: "2", unit: "unit" } }, prepTime: "", totalTime: "20 minutes" }),
    sourceRecipe({ id: "lentil-soup", name: "Hearty Lentil Soup", ingredients: { Lentil: { amount: "1", unit: "cup" } }, prepTime: "5 minutes", totalTime: "1 hour 5 minutes" }),
    sourceRecipe({ id: "berry-drink", name: "Strawberry Spritz", ingredients: { Strawberry: { amount: "1/2", unit: "cup" } } }),
    sourceRecipe({ id: "banana-cake", name: "Banana Cake", ingredients: { Banana: { amount: "2", unit: "unit" } } }),
    sourceRecipe({ id: "vegan-conflict", name: "Vegan Butter Bowl", tags: ["Vegan"], ingredients: { Butter: { amount: "1", unit: "tablespoon" } } }),
    sourceRecipe({ id: "gluten-conflict", name: "Contradictory Flour Bowl", tags: ["Gluten-free"], ingredients: { "Wheat Flour": { amount: "1", unit: "cup" } } }),
  ];
  const result = transformMeals({ selectedRecipes: source, allRecipes: source, existingIngredients, hemisphere: "northern" });
  const bySourceName = new Map(result.recipes.map(({ data }) => [data.name, data]));

  assert.deepEqual(bySourceName.get("Summer Tomato Salad").seasons, ["summer"]);
  assert.deepEqual(bySourceName.get("Hearty Lentil Soup").seasons, ["fall", "winter"]);
  assert.deepEqual(bySourceName.get("Strawberry Spritz").seasons, ["spring", "summer"]);
  assert.deepEqual(bySourceName.get("Banana Cake").seasons, ["year-round"]);
  assert.deepEqual(bySourceName.get("Hearty Lentil Soup").times, { prep_minutes: 5, cook_minutes: 60 });
  assert.equal(bySourceName.get("Summer Tomato Salad").times.prep_minutes, 10);
  assert.ok(!bySourceName.get("Vegan Butter Bowl").dietary.includes("vegan"));
  assert.ok(bySourceName.get("Vegan Butter Bowl").allergens.includes("milk"));
  assert.ok(!bySourceName.get("Contradictory Flour Bowl").dietary.includes("gluten-free"));
  assert.ok(bySourceName.get("Contradictory Flour Bowl").allergens.includes("wheat"));
  assert.deepEqual(result.audit.inferredPrepTime, ["summer-salad"]);
  assert.deepEqual(result.audit.dietaryConflicts, [
    { recipe_id: "vegan-conflict", source_tag: "Vegan" },
    { recipe_id: "gluten-conflict", source_tag: "Gluten-free" },
  ]);
  assert.ok(result.recipes.every(({ data }) => data.instructions.every((step) => step.text.startsWith("REWRITE REQUIRED:"))));

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const recipeSchema = JSON.parse(await readFile(new URL("../schemas/recipe.schema.json", import.meta.url), "utf8"));
  const ingredientSchema = JSON.parse(await readFile(new URL("../schemas/ingredient.schema.json", import.meta.url), "utf8"));
  const validateRecipe = ajv.compile(recipeSchema);
  const validateIngredient = ajv.compile(ingredientSchema);
  for (const ingredient of result.ingredients) assert.equal(validateIngredient(ingredient), true, ajv.errorsText(validateIngredient.errors));
  for (const { data } of result.recipes) assert.equal(validateRecipe(data), true, ajv.errorsText(validateRecipe.errors));
  const knownIds = new Set([...existingIngredients, ...result.ingredients].map((ingredient) => ingredient.id));
  assert.ok(result.recipes.every(({ data }) => data.ingredients.every((line) => knownIds.has(line.ingredient_id))));
});
