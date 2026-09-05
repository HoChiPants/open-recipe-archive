const fractionCharacters = new Map([
  ["¼", "1/4"], ["½", "1/2"], ["¾", "3/4"], ["⅓", "1/3"], ["⅔", "2/3"],
  ["⅛", "1/8"], ["⅜", "3/8"], ["⅝", "5/8"], ["⅞", "7/8"],
]);

const units = new Set([
  "bag", "bags", "bottle", "bottles", "box", "boxes", "can", "cans", "clove", "cloves",
  "cup", "cups", "dash", "dashes", "drop", "drops", "envelope", "envelopes", "g", "gallon",
  "gallons", "gram", "grams", "kg", "large", "lb", "lbs", "liter", "liters", "medium", "ml",
  "ounce", "ounces", "oz", "package", "packages", "packet", "packets", "piece", "pieces", "pinch",
  "pinches", "pint", "pints", "pound", "pounds", "quart", "quarts", "small", "stick", "sticks",
  "tablespoon", "tablespoons", "tbsp", "teaspoon", "teaspoons", "tsp", "whole",
]);

const preparationWords = new Set([
  "beaten", "chopped", "cooked", "cored", "crushed", "cubed", "diced", "drained", "halved",
  "hulled", "melted", "minced", "peeled", "pitted", "quartered", "rinsed", "seeded", "shredded",
  "sifted", "sliced", "softened", "thawed", "toasted", "trimmed",
]);

const actionPatterns = [
  [/(?:preheat|heat)\b/i, "preheat"], [/(?:combine|mix)\b/i, "combine"], [/(?:whisk|beat|cream)\b/i, "whisk"],
  [/fold\b/i, "fold"], [/stir\b/i, "stir"], [/blend\b/i, "blend"], [/knead\b/i, "knead"],
  [/(?:slice|cut|chop|dice|mince|trim)\b/i, "cut"], [/(?:shape|form|roll)\b/i, "shape"],
  [/(?:coat|dredge)\b/i, "coat"], [/layer\b/i, "layer"], [/(?:add|sprinkle|top)\b/i, "add"],
  [/(?:pour|transfer|place|arrange|spread)\b/i, "transfer"], [/bake\b/i, "bake"], [/roast\b/i, "roast"],
  [/(?:grill|broil)\b/i, "grill"], [/(?:fry|saute|sauté)\b/i, "sauté"], [/microwave\b/i, "microwave"],
  [/(?:canning|ferment|fermentation|preserv|sous vide)\b/i, "home preservation"],
  [/(?:boil|simmer|poach)\b/i, "simmer"], [/(?:cook|steam)\b/i, "cook"], [/(?:chill|refrigerate)\b/i, "chill"],
  [/freeze\b/i, "freeze"], [/cool\b/i, "cool"], [/rest\b/i, "rest"], [/drain\b/i, "drain"],
  [/(?:shred|pull)\b/i, "shred"], [/(?:decorate|garnish)\b/i, "garnish"], [/(?:serve|plate)\b/i, "serve"],
];

const mealTypePatterns = [
  ["breakfast", /\b(breakfast|brunch)\b/i], ["salad", /\bsalad\b/i], ["soup", /\b(soup|stew|chowder|bisque)\b/i],
  ["sandwich", /\b(sandwich|burger|quesadilla|wrap)\b/i], ["dessert", /\b(dessert|cake|cookie|pie|candy|pudding|ice cream)\b/i],
  ["drink", /\b(drink|beverage|cocktail|smoothie|coffee|tea)\b/i], ["sauce", /\b(sauce|dressing|marinade|dip)\b/i],
  ["baked-good", /\b(bread|muffin|biscuit|scone|rolls?)\b/i], ["side", /\b(side dish|side)\b/i],
  ["snack", /\b(snack|appetizer)\b/i], ["main", /\b(dinner|lunch|main dish|entree|entrée)\b/i],
];

const cuisinePattern = /\b(american|asian|british|chinese|french|greek|indian|italian|japanese|korean|mediterranean|mexican|spanish|thai|vietnamese)(?: inspired)?\b/i;

function normalizedFractions(value) {
  let result = String(value ?? "").trim();
  for (const [character, replacement] of fractionCharacters) result = result.replaceAll(character, replacement);
  return result.replace(/(\d)(\d\/\d)/g, "$1 $2").replace(/\s+/g, " ");
}

function takeQuantity(value) {
  const match = value.match(/^(\d+\/\d+|\d+(?:\.\d+)?(?:\s+\d+\/\d+)?)(?:\s*(?:-|to)\s*(\d+\/\d+|\d+(?:\.\d+)?))?\s*/i);
  if (!match) return { quantity: "", rest: value };
  return {
    quantity: match[2] ? `${match[1]}-${match[2]}` : match[1],
    rest: value.slice(match[0].length),
  };
}

export function parseIngredientLine(line) {
  const normalized = normalizedFractions(line);
  let { quantity, rest } = takeQuantity(normalized);
  let unit = "";
  const attachedMetric = rest.match(/^(g|kg|ml|oz|lb|lbs)\b\s*/i);
  if (quantity && attachedMetric) {
    unit = attachedMetric[1].toLowerCase();
    rest = rest.slice(attachedMetric[0].length);
  } else {
    const firstWord = rest.match(/^([^\s,]+)\s*/)?.[1]?.toLowerCase();
    if (firstWord && units.has(firstWord.replace(/[.]$/, ""))) {
      unit = firstWord.replace(/[.]$/, "");
      rest = rest.slice(rest.match(/^([^\s,]+)\s*/)[0].length);
    }
  }

  let packagePreparation = "";
  const packageMatch = rest.match(/^\(([^)]+)\)\s*(can|bottle|box|package|packet|bag)s?\s*/i);
  if (packageMatch) {
    unit = packageMatch[2].toLowerCase();
    packagePreparation = packageMatch[1].trim();
    rest = rest.slice(packageMatch[0].length);
  }

  const separator = rest.match(/,|\s[-–—]\s/);
  const separatorIndex = separator?.index ?? -1;
  let item = (separatorIndex === -1 ? rest : rest.slice(0, separatorIndex)).trim().replace(/^[-–—]\s*/, "");
  let preparation = (separatorIndex === -1 ? "" : rest.slice(separatorIndex + separator[0].length)).trim();
  const words = item.split(/\s+/);
  const leadingPreparation = [];
  while (words.length > 1 && preparationWords.has(words[0].toLowerCase().replace(/,$/, ""))) {
    leadingPreparation.push(words.shift());
  }
  item = words.join(" ").trim();
  preparation = [packagePreparation, leadingPreparation.join(" "), preparation].filter(Boolean).join(", ");
  const optional = /\boptional\b/i.test(normalized);
  if (!item) item = normalized || "unknown ingredient";
  return { item, quantity, unit, preparation, optional };
}

function instructionClauses(lines) {
  return lines.flatMap((line) => String(line).split(/(?:;|\.(?=\s+[A-Z]))/)).map((line) => line.trim()).filter(Boolean);
}

function operationForClause(clause, ingredientFacts) {
  const action = actionPatterns.find(([pattern]) => pattern.test(clause))?.[1] ?? "prepare";
  const temperature = clause.match(/\b(\d{2,3})\s*(?:°|degrees?\s*)?F\b/i);
  const duration = clause.match(/\b(?:about\s+)?(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/i);
  const durationMinutes = duration ? Math.round(Number(duration[1]) * (/hour|hr/i.test(duration[2]) ? 60 : 1)) : 0;
  const endpoint = clause.match(/\b(golden brown|lightly browned|tender|smooth|soft peaks?|stiff peaks?|melted|thick(?:ened)?|set|firm|opaque|easily flaked|cooked through|combined|evenly coated|boiling|simmering|frozen solid)\b/i)?.[1]?.toLowerCase() ?? "";
  const lowerClause = clause.toLowerCase();
  const ingredients = ingredientFacts.map((ingredient) => ingredient.item)
    .filter((item) => item.split(/\s+/).some((word) => word.length >= 4 && lowerClause.includes(word.toLowerCase())));
  return {
    action,
    ingredients: [...new Set(ingredients)],
    temperature_f: temperature ? Number(temperature[1]) : 0,
    duration_minutes: durationMinutes,
    endpoint,
  };
}

function inferMealType(candidate) {
  const text = `${candidate.extracted?.name ?? ""} ${(candidate.extracted?.categories ?? []).join(" ")}`;
  return mealTypePatterns.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
}

function inferCuisine(categories) {
  return categories.map((category) => String(category).match(cuisinePattern)?.[0]).find(Boolean) ?? "";
}

function safetyFlags(ingredients, instructions) {
  const ingredientText = ingredients.map((ingredient) => ingredient.item).join(" ").toLowerCase();
  const instructionText = instructions.join(" ").toLowerCase();
  const flags = [];
  if (/\b(chicken|duck|turkey|beef|pork|veal|lamb|goat|sausage|rabbit|venison|fish|salmon|tuna|cod|egg|shrimp|shellfish|oyster|mussel|clam|crab|lobster)\b/.test(ingredientText)) {
    flags.push("raw animal protein or egg may require a safe endpoint");
  }
  if (/\b(canning|ferment|fermentation|preserv|sous vide)\b/.test(instructionText)) flags.push("manual preservation safety review");
  return flags;
}

export function deterministicRecipeFacts(candidate) {
  const extracted = candidate?.extracted ?? {};
  const ingredientLines = Array.isArray(extracted.ingredient_lines) ? extracted.ingredient_lines.filter((line) => String(line).trim()) : [];
  const instructionLines = Array.isArray(extracted.instruction_lines) ? extracted.instruction_lines.filter((line) => String(line).trim()) : [];
  const yieldQuantity = Number(extracted.yield?.quantity ?? 0);
  const complete = Boolean(String(extracted.name ?? "").trim()) && ingredientLines.length >= 2 && instructionLines.length >= 1 && yieldQuantity > 0;
  const ingredients = ingredientLines.map(parseIngredientLine);
  const categories = Array.isArray(extracted.categories) ? extracted.categories.map(String).filter(Boolean) : [];
  return {
    status: complete ? "usable" : "skip",
    reason: complete ? "Facts extracted deterministically from structured candidate fields." : "Candidate is missing a title, yield, two ingredients, or cooking instructions.",
    base_name: String(extracted.name ?? "").trim(),
    meal_type: inferMealType(candidate),
    cuisine: inferCuisine(categories),
    yield: { quantity: Number.isFinite(yieldQuantity) ? yieldQuantity : 0, unit: String(extracted.yield?.unit ?? "") },
    times: {
      prep_minutes: Math.max(0, Math.round(Number(extracted.times?.prep_minutes ?? 0) || 0)),
      cook_minutes: Math.max(0, Math.round(Number(extracted.times?.cook_minutes ?? 0) || 0)),
      inactive_minutes: Math.max(0, Math.round(Number(extracted.times?.inactive_minutes ?? 0) || 0)),
    },
    ingredients,
    operations: instructionClauses(instructionLines).map((clause) => operationForClause(clause, ingredients)),
    tags: categories,
    safety_flags: safetyFlags(ingredients, instructionLines),
  };
}

function riskyTitle(candidate, recipe) {
  const title = String(recipe?.name ?? "");
  const publisher = String(candidate?.source?.name ?? "").trim();
  return /[®™]|\b(copycat|official|famous|world(?:'s)? best|award[- ]winning)\b/i.test(title)
    || (publisher.length >= 4 && title.toLowerCase().includes(publisher.toLowerCase()));
}

export function deterministicReviewDisposition(candidate, recipe, similarity, brandMatches) {
  const reasons = [];
  if (brandMatches.length) reasons.push(`configured brand terms require review: ${brandMatches.map((item) => item.term).join(", ")}`);
  if (riskyTitle(candidate, recipe)) reasons.push("recipe title may identify a brand, publisher, or promotional source title");
  if (similarity.prose_trigram_jaccard_percent >= 50) reasons.push(`source/final prose trigram overlap is ${similarity.prose_trigram_jaccard_percent}%`);
  if (similarity.max_step_trigram_jaccard_percent >= 70) reasons.push(`a final instruction overlaps a source instruction by ${similarity.max_step_trigram_jaccard_percent}%`);
  if (reasons.length) return { mode: "hold", reasons };
  if (similarity.prose_trigram_jaccard_percent >= 20 || similarity.max_step_trigram_jaccard_percent >= 35) {
    return { mode: "model", reasons: ["deterministic similarity is borderline and requires model review"] };
  }
  return { mode: "pass", reasons: [] };
}

export function deterministicPublicationReview(candidate, recipe, similarity, disposition) {
  const passed = disposition.mode === "pass";
  return {
    decision: passed ? "pass" : "hold",
    confidence: 95,
    copyright_risk: passed ? "low" : "medium",
    semantic_similarity: Math.min(100, Math.round(similarity.prose_trigram_jaccard_percent)),
    structural_similarity: Math.min(100, Math.round(similarity.max_step_trigram_jaccard_percent)),
    distinctive_expression_matches: [],
    likely_brand_terms: [],
    trademark_risk: "low",
    title_is_generic: !riskyTitle(candidate, recipe),
    implied_affiliation: false,
    reasons: passed ? ["Deterministic expression, structure, title, and brand checks passed."] : disposition.reasons,
  };
}
