import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { candidatePromotionIssues } from "./promote-candidate-lib.mjs";
import { formatAjvErrors, readJson, relative, root } from "./library.mjs";

const values = process.argv.slice(2);
function valueFor(flag) {
  const index = values.indexOf(flag);
  return index === -1 ? undefined : values[index + 1];
}

const candidateArg = valueFor("--candidate");
const recipeArg = valueFor("--recipe");
const checkOnly = values.includes("--check-only");
const removeCandidate = values.includes("--remove-candidate");

if (!candidateArg || !recipeArg) {
  console.error("Usage: npm run candidate:promote -- --candidate <review.json> --recipe <edited.json> --attest-original-wording [--remove-candidate]");
  process.exit(1);
}
if (!checkOnly && !values.includes("--attest-original-wording")) {
  console.error("Promotion requires --attest-original-wording to confirm that scraped prose was discarded and the directions were independently written.");
  process.exit(1);
}

const candidateFile = path.resolve(root, candidateArg);
const recipeFile = path.resolve(root, recipeArg);
const reviewRoot = path.join(root, "scraping", "output") + path.sep;
if (!candidateFile.startsWith(reviewRoot)) {
  console.error("Candidate must be inside scraping/output.");
  process.exit(1);
}

const candidate = await readJson(candidateFile);
const recipe = await readJson(recipeFile);
const schema = await readJson(path.join(root, "schemas", "recipe.schema.json"));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const issues = candidatePromotionIssues(candidate, recipe);
if (!validate(recipe)) issues.push(formatAjvErrors(validate.errors));
if (issues.length) {
  console.error(`Cannot promote ${relative(candidateFile)}:`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

if (checkOnly) {
  console.log(`Ready to promote ${relative(candidateFile)} as ${recipe.id}.`);
  process.exit(0);
}

const folders = {
  main: "mains", side: "sides", sandwich: "sandwiches", dessert: "desserts", drink: "drinks",
  snack: "snacks", soup: "soups", salad: "salads", sauce: "sauces", "baked-good": "baked-goods",
};
const destination = path.join(root, "recipes", folders[recipe.meal_type] ?? recipe.meal_type, `${recipe.id}.json`);
try {
  await access(destination);
  console.error(`A finalized recipe already exists at ${relative(destination)}.`);
  process.exit(1);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

await mkdir(path.dirname(destination), { recursive: true });
await cp(recipeFile, destination);
if (removeCandidate) await rm(candidateFile);
console.log(`Promoted ${relative(candidateFile)} to ${relative(destination)}${removeCandidate ? " and removed it from review" : ""}.`);
