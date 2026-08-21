import { createHash } from "node:crypto";
import {
  buildIngredientIndex,
  inferIngredientAllergens,
  inferIngredientCategory,
  inferIngredientSeasons,
  normalizeUnit,
  normalizedLookup,
  slug,
} from "./import-meals-lib.mjs";

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function canonicalId(name, key, reservedIds) {
  let base = slug(name);
  if (base.length < 2) base = `ingredient-${base || shortHash(key)}`;
  if (!reservedIds.has(base)) return base;
  return `${base.slice(0, 91)}-${shortHash(key)}`;
}

function displayName(value) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Cannot create a canonical ingredient for an empty ingredient name.");
  if (name.length > 120) throw new Error(`Ingredient name is longer than 120 characters: '${name}'.`);
  return `${name[0].toUpperCase()}${name.slice(1)}`;
}

/**
 * Plans deterministic catalog records without touching disk. Callers can validate
 * the complete plan before writing any files.
 */
export function planCanonicalIngredients(factualIngredients, existingIngredients, hemisphere = "northern") {
  const { lookup, byId } = buildIngredientIndex(existingIngredients);
  const reservedIds = new Set(byId.keys());
  const created = [];

  for (const usage of factualIngredients) {
    const name = displayName(usage.item);
    const key = normalizedLookup(name);
    if (lookup.has(key)) continue;

    const id = canonicalId(name, key, reservedIds);
    const category = inferIngredientCategory(name);
    const defaultUnit = normalizeUnit(usage.unit);
    const allergens = inferIngredientAllergens(name);
    const ingredient = {
      $schema: "../schemas/ingredient.schema.json",
      schema_version: "1.0.0",
      id,
      name,
      categories: [category],
      seasons: inferIngredientSeasons(name, category, hemisphere),
      ...(defaultUnit && defaultUnit.length <= 40 ? { default_unit: defaultUnit } : {}),
      ...(allergens.length ? { allergens } : {}),
      notes: "Category, seasonality, default unit, and allergens were inferred during automatic recipe promotion.",
    };
    created.push(ingredient);
    reservedIds.add(id);
    byId.set(id, ingredient);
    lookup.set(key, ingredient);
  }

  return created;
}

export function missingCanonicalIngredientIds(recipe) {
  return recipe.ingredients
    .filter((ingredient) => !ingredient.ingredient_id)
    .map((ingredient) => ingredient.item);
}
