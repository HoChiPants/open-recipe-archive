import { createHash } from "node:crypto";

const mealFolders = {
  main: "mains", side: "sides", sandwich: "sandwiches", dessert: "desserts", drink: "drinks",
  snack: "snacks", soup: "soups", salad: "salads", sauce: "sauces", "baked-good": "baked-goods",
};

const highRiskTerms = [
  "beef", "chicken", "duck", "fish", "goat", "lamb", "meat", "pork", "rabbit", "salmon", "sausage",
  "shellfish", "shrimp", "steak", "turkey", "venison", "canning", "ferment", "preserve", "sous vide",
];

const allergenTerms = {
  milk: ["butter", "cheese", "cream", "feta", "ghee", "milk", "yogurt"],
  eggs: ["egg"],
  fish: ["anchovy", "cod", "fish", "salmon", "tuna"],
  shellfish: ["clam", "crab", "lobster", "mussel", "oyster", "shrimp"],
  "tree-nuts": ["almond", "cashew", "hazelnut", "pecan", "pistachio", "walnut"],
  peanuts: ["peanut"],
  wheat: ["bread", "flour", "pasta", "wheat"],
  soy: ["soy", "tofu"],
  sesame: ["sesame", "tahini"],
};

const stopwords = new Set("a an and are as at be by for from in into is it of on or that the their then this to until with".split(" "));

export function slug(value) {
  return String(value || "recipe")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90) || "recipe";
}

export function uniqueRecipeId(name, sourceUrl, existingIds) {
  const base = slug(name);
  if (!existingIds.has(base)) return base;
  const suffix = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 8);
  return `${base.slice(0, 91)}-${suffix}`;
}

export function recipeFolder(mealType) {
  return mealFolders[mealType] ?? mealType;
}

function quantity(value) {
  const clean = String(value || "").trim();
  if (!clean) return undefined;
  return /^\d+(?:\.\d+)?$/.test(clean) ? Number(clean) : clean;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

export function materializeRecipe(candidate, generated, existingIds, canonicalIngredients = []) {
  const draft = generated.recipe;
  const today = new Date().toISOString().slice(0, 10);
  const canonical = new Map();
  for (const ingredient of canonicalIngredients) {
    for (const name of [ingredient.name, ...(ingredient.aliases ?? [])]) canonical.set(slug(name), ingredient.id);
  }
  const id = uniqueRecipeId(draft.name, candidate.source.url, existingIds);
  const recipe = {
    $schema: "../../schemas/recipe.schema.json",
    schema_version: "1.0.0",
    id,
    name: draft.name.trim(),
    ...compactObject({ subtitle: draft.subtitle.trim(), description: draft.description.trim() }),
    meal_type: draft.meal_type,
    ...compactObject({ cuisine: draft.cuisine.trim() }),
    yield: { quantity: draft.yield.quantity, unit: draft.yield.unit.trim() || "servings" },
    times: compactObject({
      prep_minutes: draft.times.prep_minutes,
      cook_minutes: draft.times.cook_minutes,
      inactive_minutes: draft.times.inactive_minutes || undefined,
    }),
    ingredients: draft.ingredients.map((item) => compactObject({
      ingredient_id: canonical.get(slug(item.item)),
      item: item.item.trim(),
      quantity: quantity(item.quantity),
      unit: item.unit.trim(),
      preparation: item.preparation.trim(),
      optional: item.optional || undefined,
    })),
    instructions: draft.instructions.map((instruction, index) => compactObject({
      step: index + 1,
      text: instruction.text.trim(),
      timer_minutes: instruction.timer_minutes || undefined,
    })),
    tags: [...new Set(draft.tags.map(slug).filter(Boolean))],
    seasons: [...new Set(draft.seasons)],
    dietary: [...new Set(draft.dietary)],
    allergens: [...new Set(draft.allergens)],
    equipment: [...new Set(draft.equipment.map((item) => item.trim()).filter(Boolean))],
    source: { name: candidate.source.name, url: candidate.source.url, adapted: true },
    created_at: today,
    updated_at: today,
  };
  for (const key of ["seasons", "dietary", "allergens", "equipment"]) {
    if (!recipe[key].length) delete recipe[key];
  }
  return recipe;
}

export function automaticReviewReasons(facts, generated, recipe, minimumConfidence = 85) {
  const reasons = [];
  if (facts.status !== "usable") reasons.push(`fact extraction skipped: ${facts.reason}`);
  if (generated.status !== "promote") reasons.push(`authoring skipped: ${generated.reason}`);
  if (generated.confidence < minimumConfidence) reasons.push(`confidence ${generated.confidence} is below ${minimumConfidence}`);
  if (generated.status === "promote" && generated.variation_changes.length < 1) reasons.push("no substantive variation was recorded");
  if (slug(recipe.name) === slug(facts.base_name)) reasons.push("generated title is unchanged from the candidate");
  if (facts.safety_flags.length) reasons.push(`safety flags: ${facts.safety_flags.join(", ")}`);

  const ingredientText = recipe.ingredients.map((item) => item.item).join(" ").toLowerCase();
  const factIngredients = new Set(facts.ingredients.map((item) => slug(item.item).replace(/s$/, "")));
  const newIngredients = recipe.ingredients.filter((item) => !factIngredients.has(slug(item.item).replace(/s$/, "")));
  if (generated.status === "promote" && !newIngredients.length) reasons.push("variation does not introduce a new secondary ingredient");
  const risky = highRiskTerms.filter((term) => ingredientText.includes(term));
  if (risky.length) reasons.push(`high-risk ingredients require review: ${[...new Set(risky)].join(", ")}`);
  if (recipe.ingredients.length < 2) reasons.push("fewer than two ingredients");
  if (recipe.instructions.length < 1) reasons.push("missing instructions");
  if (recipe.tags.length < 1) reasons.push("missing tags");

  const declaredAllergens = new Set(recipe.allergens ?? []);
  for (const [allergen, terms] of Object.entries(allergenTerms)) {
    if (terms.some((term) => ingredientText.includes(term)) && !declaredAllergens.has(allergen)) {
      reasons.push(`possible undeclared ${allergen} allergen`);
    }
  }
  const dietary = new Set(recipe.dietary ?? []);
  if (declaredAllergens.has("milk") && dietary.has("dairy-free")) reasons.push("dairy-free conflicts with milk allergen");
  if (declaredAllergens.has("eggs") && dietary.has("egg-free")) reasons.push("egg-free conflicts with egg allergen");
  if (declaredAllergens.has("wheat") && dietary.has("gluten-free")) reasons.push("gluten-free conflicts with wheat allergen");
  if ((declaredAllergens.has("tree-nuts") || declaredAllergens.has("peanuts")) && dietary.has("nut-free")) reasons.push("nut-free conflicts with nut allergen");
  if (["milk", "eggs", "fish", "shellfish"].some((allergen) => declaredAllergens.has(allergen)) && dietary.has("vegan")) {
    reasons.push("vegan conflicts with animal-derived ingredients");
  }
  return [...new Set(reasons)];
}

export function proseWords(value) {
  return String(value || "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function candidateProse(candidate) {
  return [candidate.extracted?.description, ...(candidate.extracted?.instruction_lines ?? [])].filter(Boolean).join(" ");
}

export function recipeProse(recipe) {
  return [recipe.subtitle, recipe.description, ...recipe.instructions.map((item) => item.text)].filter(Boolean).join(" ");
}

export function proseMetrics(candidate, recipe) {
  const sourceWords = proseWords(candidateProse(candidate));
  const finalWords = proseWords(recipeProse(recipe));
  return {
    source_word_count: sourceWords.length,
    final_word_count: finalWords.length,
    final_word_count_change_percent: sourceWords.length ? Math.round((finalWords.length / sourceWords.length - 1) * 1000) / 10 : 0,
  };
}

export function removedWordFrequency(candidate, recipe) {
  const final = new Set(proseWords(recipeProse(recipe)));
  const counts = new Map();
  for (const word of proseWords(candidateProse(candidate))) {
    if (word.length < 4 || stopwords.has(word) || final.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

export function topWords(frequency, limit = 25) {
  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}
