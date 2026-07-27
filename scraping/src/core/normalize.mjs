import { parseDuration, slugify, unique } from "./utils.mjs";

function plainText(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function instructions(value) {
  const flat = [];
  const visit = (item) => {
    if (typeof item === "string") flat.push(item);
    else if (item?.text) flat.push(item.text);
    else if (Array.isArray(item?.itemListElement)) item.itemListElement.forEach(visit);
  };
  (Array.isArray(value) ? value : [value]).forEach(visit);
  return flat.map(plainText).filter(Boolean);
}

function yieldValue(value) {
  const match = String(Array.isArray(value) ? value[0] : value || "").match(/([\d.]+)\s*(.*)/);
  return { quantity: Number(match?.[1]) || 1, unit: plainText(match?.[2]) || "servings" };
}

export function normalizeCandidate(raw, url, site) {
  const name = plainText(raw.name) || "Untitled recipe";
  const prep = parseDuration(raw.prepTime);
  const cook = parseDuration(raw.cookTime);
  const total = parseDuration(raw.totalTime);
  const categories = [raw.recipeCategory, raw.recipeCuisine, raw.keywords].flat().flatMap((v) => String(v || "").split(","));
  return {
    candidate_version: "1.0.0",
    review_status: "needs-review-and-original-wording",
    source: { name: site.name, url, retrieved_at: new Date().toISOString() },
    extracted: {
      id: slugify(name), name, description: plainText(raw.description),
      yield: yieldValue(raw.recipeYield),
      times: { prep_minutes: prep, cook_minutes: cook, inactive_minutes: Math.max(0, total - prep - cook) },
      ingredient_lines: (raw.recipeIngredient || raw.ingredients || []).map(plainText).filter(Boolean),
      instruction_lines: instructions(raw.recipeInstructions),
      categories: unique(categories.map(plainText).filter(Boolean)),
      nutrition: raw.nutrition || null
    },
    review_notes: [
      "Verify every extracted fact against the authorized source.",
      "Rewrite expressive instruction and description text; do not publish scraped prose verbatim.",
      "Map ingredient lines, meal type, tags, allergens, and dietary fields to the repository schema."
    ]
  };
}

