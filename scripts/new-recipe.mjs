import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { root } from "./library.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
    return pairs;
  }, []),
);

if (!args.name || !args.type) {
  console.error('Usage: npm run recipe:new -- --name "Recipe name" --type main');
  process.exit(1);
}

const allowed = new Set([
  "breakfast", "main", "side", "salad", "soup", "sandwich", "dessert", "snack", "drink", "sauce", "baked-good", "other",
]);
if (!allowed.has(args.type)) {
  console.error(`Unknown type '${args.type}'. Choose: ${[...allowed].join(", ")}`);
  process.exit(1);
}

const folders = { main: "mains", side: "sides", sandwich: "sandwiches", dessert: "desserts", drink: "drinks", snack: "snacks", soup: "soups", salad: "salads", sauce: "sauces", "baked-good": "baked-goods" };
const id = (args.id || args.name)
  .toLowerCase()
  .normalize("NFKD")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
const folder = folders[args.type] || args.type;
const file = path.join(root, "recipes", folder, `${id}.json`);
try {
  await access(file);
  console.error(`A recipe already exists at recipes/${folder}/${id}.json`);
  process.exit(1);
} catch {}

const today = new Date().toISOString().slice(0, 10);
const recipe = {
  $schema: "../../schemas/recipe.schema.json",
  schema_version: "1.0.0",
  id,
  name: args.name,
  meal_type: args.type,
  yield: { quantity: 4, unit: "servings" },
  times: { prep_minutes: 10, cook_minutes: 20 },
  ingredients: [{ item: "Add an ingredient", quantity: 1, unit: "unit" }],
  instructions: [{ step: 1, text: "Write the first instruction." }],
  tags: [args.type],
  created_at: today,
  updated_at: today,
};

await mkdir(path.dirname(file), { recursive: true });
await writeFile(file, `${JSON.stringify(recipe, null, 2)}\n`);
console.log(`Created recipes/${folder}/${id}.json`);
