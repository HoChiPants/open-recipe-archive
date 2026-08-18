import { createHash } from "node:crypto";

const SEASON_ORDER = ["spring", "summer", "fall", "winter"];
const ALLERGEN_ORDER = ["milk", "eggs", "fish", "shellfish", "tree-nuts", "peanuts", "wheat", "soy", "sesame"];
const DIETARY_ORDER = ["vegetarian", "vegan", "gluten-free", "dairy-free", "nut-free", "egg-free", "low-sodium"];

const ALLERGEN_TAGS = new Map([
  ["milk", "milk"],
  ["eggs", "eggs"],
  ["egg", "eggs"],
  ["fish", "fish"],
  ["shellfish", "shellfish"],
  ["tree nuts", "tree-nuts"],
  ["tree-nuts", "tree-nuts"],
  ["peanuts", "peanuts"],
  ["peanut", "peanuts"],
  ["wheat", "wheat"],
  ["soy", "soy"],
  ["sesame", "sesame"],
]);

const INGREDIENT_SYNONYMS = new Map([
  ["extra virgin olive oil", "olive-oil"],
  ["extra-virgin olive oil", "olive-oil"],
  ["evoo", "olive-oil"],
  ["fresh mozzarella cheese", "mozzarella"],
  ["yellow onions", "onion"],
  ["yellow onion", "onion"],
  ["garlic cloves", "garlic"],
  ["garlic clove", "garlic"],
]);

const SEASON_RULES = [
  { test: /\b(asparagus|artichoke|rhubarb|ramp|fava bean|morel)\b/, seasons: ["spring"] },
  { test: /\b(strawberr|snap pea|snow pea|fresh pea|radish|watercress)\w*\b/, seasons: ["spring", "summer"] },
  { test: /\b(apricot|blackberr|blueberr|boysenberr|cherr|nectarine|peach|raspberr|watermelon|cantaloupe|honeydew)\w*\b/, seasons: ["summer"] },
  { test: /\b(tomato|tomatoes|tomatillo|cucumber|eggplant|zucchini|yellow squash|summer squash|okra|corn(?: on the cob)?|green bean|bell pepper|poblano|jalape[nñ]o|basil)\b/, seasons: ["summer", "fall"] },
  { test: /\b(apple|pear|fig|grape|persimmon)\w*\b/, seasons: ["fall"] },
  { test: /\b(cranberr|pomegranate|pumpkin|butternut|acorn squash|delicata|spaghetti squash|winter squash|sweet potato)\w*\b/, seasons: ["fall", "winter"] },
  { test: /\b(beet|broccoli|brussels sprout|cabbage|carrot|cauliflower|celeriac|collard|fennel|kale|leek|parsnip|potato|rutabaga|turnip)\w*\b/, seasons: ["fall", "winter"] },
  { test: /\b(celery|mushroom)\w*\b/, seasons: ["fall"] },
  { test: /\b(arugula|chard|lettuce|mixed greens|spinach)\b/, seasons: ["spring", "fall"] },
  { test: /\b(mint|chive|cilantro|dill|scallion|tarragon)\w*\b/, seasons: ["spring", "summer"] },
  { test: /\b(blood orange|cara cara orange|mandarin orange|meyer lemon|orange|lime)\w*\b/, seasons: ["winter", "year-round"] },
];

const FOLDER_BY_TYPE = {
  main: "mains",
  side: "sides",
  sandwich: "sandwiches",
  dessert: "desserts",
  drink: "drinks",
  snack: "snacks",
  soup: "soups",
  salad: "salads",
  sauce: "sauces",
  "baked-good": "baked-goods",
};

export function slug(value, maxLength = 100) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[®™©]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength)
    .replace(/-$/g, "");
}

export function normalizedLookup(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[®™©*]/g, "")
    .replace(/\([^)]*(?:optional|not included)[^)]*\)/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function cleanIngredientName(value) {
  const raw = String(value ?? "").trim();
  const optional = /\boptional\b|\bnot included\b/i.test(raw);
  const item = raw
    .replace(/[®™©]/g, "")
    .replace(/\*+/g, "")
    .replace(/\s*\([^)]*(?:optional|not included)[^)]*\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { item: item || "Unspecified ingredient", optional };
}

export function parseMinutes(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return undefined;
  let total = 0;
  let matched = false;
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|minutes?|mins?|min)\b/g)) {
    const amount = Number(match[1]);
    total += /^(?:h|hr)/.test(match[2]) ? amount * 60 : amount;
    matched = true;
  }
  if (!matched) {
    const number = Number(text.match(/\d+(?:\.\d+)?/)?.[0]);
    if (Number.isFinite(number)) return Math.round(number);
    return undefined;
  }
  return Math.round(total);
}

export function normalizeQuantity(value, unit) {
  const amount = String(value ?? "").trim();
  const rawUnit = String(unit ?? "").trim();
  const normalizedUnit = normalizeUnit(unit);
  if (!amount) return { missing: true, ...(normalizedUnit ? { unit: normalizedUnit } : {}) };
  if (/^(?:unit|box|pack|package|ounce|ounces|tablespoon|teaspoon|cup|clove|bunch)$/i.test(amount) && !normalizedUnit) {
    return { malformed: true };
  }
  const missingUnit = !rawUnit && Boolean(amount);
  if (/^\d+(?:\.\d+)?$/.test(amount)) return { quantity: Number(amount), ...(normalizedUnit ? { unit: normalizedUnit } : {}), ...(missingUnit ? { missingUnit: true } : {}) };
  const mixed = amount.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed && Number(mixed[3])) {
    return { quantity: Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]), ...(normalizedUnit ? { unit: normalizedUnit } : {}), ...(missingUnit ? { missingUnit: true } : {}) };
  }
  return { quantity: amount, ...(normalizedUnit ? { unit: normalizedUnit } : {}), ...(missingUnit ? { missingUnit: true } : {}) };
}

export function normalizeUnit(value) {
  const unit = String(value ?? "").trim();
  if (!unit || unit.toLowerCase() === "unit") return undefined;
  const aliases = new Map([
    ["ounce(oz)", "ounce"],
    ["ounces", "ounce"],
    ["tablespoons", "tablespoon"],
    ["teaspoons", "teaspoon"],
    ["cups", "cup"],
    ["cloves", "clove"],
  ]);
  return aliases.get(unit.toLowerCase()) ?? unit;
}

export function inferIngredientCategory(name) {
  const text = normalizedLookup(name);
  const plantBasedDairy = /\b(coconut|almond|oat|soy|vegan|plant based)\b/.test(text);
  if (/\b(seasoning|spice|spices|rub)\b/.test(text)) return "spice";
  if (/\b(stock|broth|concentrate|sauce|vinegar|mustard|mayonnaise|mayo|ketchup|dressing|glaze|paste|spread|relish|pickle|hoisin|salsa|pesto|tahini)\w*\b/.test(text)) return "condiment";
  if (!plantBasedDairy && /\b(milk|cheese|cream|crema|yogurt|butter|ghee|buttermilk|mozzarella|parmesan|cheddar|feta|gouda|brie|mascarpone|ricotta|burrata)\b/.test(text)) return "dairy";
  if (/\b(chicken|beef|steak|pork|bacon|ham|turkey|duck|venison|lamb|sausage|prosciutto|salami|fish|salmon|trout|steelhead|cod|cobia|tilapia|tuna|halibut|barramundi|shrimp|prawn|scallop|lobster|crab|mussel|clam|tofu|tempeh|seitan)\w*\b|\beggs?\b/.test(text)) return "protein";
  if (/\b(bean|lentil|chickpea|garbanzo|edamame|split pea)\w*\b/.test(text)) return "legume";
  if (/\b(rice|pasta|noodle|bread|baguette|bun|tortilla|couscous|polenta|oat|barley|farro|freekeh|quinoa|bulgur|orzo|ravioli|tortellini|gnocchi|panko|breadcrumb|flatbread|naan|ciabatta)\w*\b/.test(text)) return "grain";
  if (/\b(basil|parsley|thyme|mint|cilantro|coriander leaves|rosemary|sage|oregano|chive|dill|tarragon)\w*\b/.test(text)) return "herb";
  if (/\b(salt|pepper|paprika|cumin|cinnamon|chili powder|curry powder|turmeric|nutmeg|clove|cardamom|coriander|allspice|cayenne|chili flake)\w*\b/.test(text)) return "spice";
  if (/\b(oil|shortening)\b/.test(text)) return "oil";
  if (/\b(sugar|honey|syrup|agave|molasses|jam|preserve|marmalade)\w*\b/.test(text)) return "sweetener";
  if (/\b(flour|yeast|baking soda|baking powder|cornstarch|cocoa|chocolate chip|cake mix|pie|pie crust)\w*\b/.test(text)) return "baking";
  if (/\b(wine|beer|juice|cider|coffee|tea|seltzer|sparkling water)\b/.test(text)) return "beverage";
  if (SEASON_RULES.some((rule) => rule.test.test(text)) || /\b(onion|shallot|garlic|potato|carrot|celery|avocado|banana|lemon|lime|orange|mushroom|ginger|scallion|lettuce|greens|fruit|vegetable)\w*\b/.test(text)) return "produce";
  return "other";
}

function isPreservedIngredient(name) {
  return /\b(canned|can of|dried|dry|frozen|powder|paste|concentrate|stock|broth|sauce|jam|preserve|juice|puree|purée|sun dried|sun-dried)\b/.test(normalizedLookup(name));
}

export function inferIngredientSeasons(name, category, hemisphere = "northern") {
  if (isPreservedIngredient(name) || !["produce", "herb"].includes(category)) return ["year-round"];
  const text = normalizedLookup(name);
  const matched = SEASON_RULES.find((rule) => rule.test.test(text));
  const northern = matched?.seasons ?? ["year-round"];
  return hemisphere === "southern" ? northern.map(oppositeSeason) : northern;
}

function oppositeSeason(season) {
  return { spring: "fall", summer: "winter", fall: "spring", winter: "summer" }[season] ?? season;
}

export function inferIngredientAllergens(name) {
  const text = normalizedLookup(name);
  const found = new Set();
  const plantBasedDairy = /\b(coconut|almond|oat|soy|vegan|plant based)\b/.test(text);
  const explicitlyPlantBased = /\b(vegan|plant based)\b/.test(text);
  if (!plantBasedDairy && /\b(milk|cheese|cream|crema|yogurt|butter|ghee|buttermilk|whey|mozzarella|parmesan|cheddar|feta|gouda|brie|mascarpone|ricotta|burrata)\b/.test(text)) found.add("milk");
  if (!explicitlyPlantBased && /\beggs?\b|\b(mayonnaise|mayo|aioli)\b/.test(text)) found.add("eggs");
  if (/\b(fish|salmon|trout|steelhead|cod|cobia|tilapia|tuna|halibut|barramundi|anchov|mahi|haddock)\w*\b/.test(text)) found.add("fish");
  if (/\b(shrimp|prawn|scallop|lobster|crab|mussel|clam|oyster)\w*\b/.test(text)) found.add("shellfish");
  if (/\b(almond|walnut|pecan|cashew|pistachio|hazelnut|pine nut|macadamia|brazil nut)\w*\b/.test(text)) found.add("tree-nuts");
  if (/\bpeanut\w*\b/.test(text)) found.add("peanuts");
  const explicitlyNonWheat = /\b(corn|rice|almond|coconut|chickpea|cassava|gluten free)\s+flour\b|\b(rice|glass|cellophane) noodles?\b/.test(text);
  if (!explicitlyNonWheat && /\b(wheat|flour|panko|breadcrumb|bread|baguette|pasta|noodles?|couscous|bulgur|farro|freekeh|orzo|ravioli|tortellini|gnocchi|ciabatta|naan|flatbread|pizza dough)\w*\b/.test(text)) found.add("wheat");
  if (/\b(soy|tofu|tempeh|edamame|miso)\w*\b/.test(text)) found.add("soy");
  if (/\b(sesame|tahini)\w*\b/.test(text)) found.add("sesame");
  return ALLERGEN_ORDER.filter((item) => found.has(item));
}

export function buildIngredientIndex(existingIngredients) {
  const lookup = new Map();
  const byId = new Map();
  for (const ingredient of existingIngredients) {
    byId.set(ingredient.id, ingredient);
    for (const value of [ingredient.id, ingredient.name, ...(ingredient.aliases ?? [])]) {
      const key = normalizedLookup(value);
      const previous = lookup.get(key);
      if (key && previous && previous.id !== ingredient.id) {
        throw new Error(`Ambiguous canonical ingredient alias '${value}' belongs to both '${previous.id}' and '${ingredient.id}'.`);
      }
      if (key) lookup.set(key, ingredient);
    }
  }
  return { lookup, byId };
}

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function candidateId(name, key, reservedIds) {
  const base = slug(name) || `ingredient-${shortHash(key)}`;
  if (!reservedIds.has(base)) return base;
  return `${base.slice(0, 91)}-${shortHash(key)}`;
}

function mostCommonUnit(usages) {
  const counts = new Map();
  for (const usage of usages) {
    const unit = normalizeUnit(usage.value?.unit);
    if (unit) counts.set(unit, (counts.get(unit) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

export function buildIngredientCatalog(sourceRecipes, existingIngredients, hemisphere = "northern") {
  const existing = buildIngredientIndex(existingIngredients);
  const groups = new Map();
  for (const recipe of sourceRecipes) {
    for (const [rawName, value] of Object.entries(recipe.ingredients ?? {})) {
      const cleaned = cleanIngredientName(rawName);
      const key = normalizedLookup(cleaned.item);
      if (!groups.has(key)) groups.set(key, { displayNames: new Set(), usages: [] });
      const group = groups.get(key);
      group.displayNames.add(cleaned.item);
      group.usages.push({ recipeId: recipe.id, rawName, value });
    }
  }

  const reservedIds = new Set(existing.byId.keys());
  const resolved = new Map();
  const candidates = [];
  const fallbackSeasonIngredients = [];
  for (const [key, group] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const synonymId = INGREDIENT_SYNONYMS.get(key);
    const match = existing.lookup.get(key) ?? (synonymId ? existing.byId.get(synonymId) : undefined);
    if (match) {
      resolved.set(key, match);
      continue;
    }
    const names = [...group.displayNames].sort((a, b) => a.localeCompare(b));
    const name = names[0];
    let id = candidateId(name, key, reservedIds);
    while (reservedIds.has(id)) id = `${slug(name, 91)}-${shortHash(`${key}-${id}`)}`;
    reservedIds.add(id);
    const categories = [inferIngredientCategory(name)];
    const seasons = inferIngredientSeasons(name, categories[0], hemisphere);
    if (seasons.length === 1 && seasons[0] === "year-round" && !isPreservedIngredient(name) && ["produce", "herb"].includes(categories[0])) {
      fallbackSeasonIngredients.push({ id, name });
    }
    const allergens = inferIngredientAllergens(name);
    const defaultUnit = mostCommonUnit(group.usages);
    const candidate = {
      $schema: "../schemas/ingredient.schema.json",
      schema_version: "1.0.0",
      id,
      name,
      ...(names.length > 1 ? { aliases: names.slice(1) } : {}),
      categories,
      seasons,
      ...(defaultUnit ? { default_unit: defaultUnit } : {}),
      ...(allergens.length ? { allergens } : {}),
      notes: `Category and ${hemisphere === "northern" ? "Northern" : "Southern"} Hemisphere seasonality were inferred during legacy import; verify before promotion.`,
    };
    candidates.push(candidate);
    resolved.set(key, candidate);
  }
  return { resolved, candidates, fallbackSeasonIngredients };
}

export function buildRecipeIdMap(sourceRecipes) {
  const bases = new Map();
  for (const recipe of sourceRecipes) {
    const fallback = `legacy-recipe-${recipe.id || shortHash(JSON.stringify(recipe))}`;
    const base = slug(recipe.name) || slug(fallback);
    if (!bases.has(base)) bases.set(base, []);
    bases.get(base).push(recipe);
  }
  const result = new Map();
  const used = new Set();
  for (const [base, recipes] of [...bases.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const recipe of [...recipes].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      const sourceSuffix = slug(recipe.id).slice(-8) || shortHash(JSON.stringify(recipe));
      let id = recipes.length === 1 ? base : `${base.slice(0, 91)}-${sourceSuffix}`;
      if (used.has(id)) id = `${base.slice(0, 91)}-${shortHash(String(recipe.id))}`;
      used.add(id);
      result.set(recipe.id, id);
    }
  }
  return result;
}

export function inferMealType(recipe) {
  // HelloFresh titles commonly list side dishes after "with". Classifying only the
  // leading dish avoids turning a steak with salad into a salad (or crispy chicken
  // into a dessert because its side is an apple crisp).
  const primary = normalizedLookup(String(recipe.name ?? "").split(/\s+with\s+/i)[0]);
  const entreeWords = /\b(beef|steak|chicken|pork|turkey|salmon|trout|barramundi|shrimp|scallop|pasta|penne|rigatoni|ravioli|tortelloni|meatball)\w*\b/;
  if (/\b(smoothie|juice|lemonade|limeade|spritz|cocktail|mocktail|punch|latte|hot chocolate|iced tea)\b/.test(primary)) return "drink";
  if (/\b(breakfast|brunch|waffles?|pancakes?|french toast|oatmeal|overnight oats?|frittata|omelet|scramble)\b/.test(primary)) return "breakfast";
  if (/\b(soup|stew|chowder|bisque)\b/.test(primary) || /(?:^|\s)chili$/.test(primary)) return "soup";
  if (/\b(sandwich(?:es)?|burger(?:s)?|taco(?:s)?|quesadilla(?:s)?|wrap(?:s)?|burrito(?:s)?|hot dog(?:s)?|slider(?:s)?|banh mi)\b/.test(primary)) return "sandwich";
  if (/\b(salad|panzanella|slaw)\b/.test(primary)) return "salad";
  if (/\b(sauce|dressing|marinade|salsa|pesto|gravy|dip)\b$/.test(primary) && !entreeWords.test(primary) && primary.split(" ").length <= 5) return "sauce";
  const savoryPie = /\b(shepherd|cottage|pot pie|cornbread pie|beef|steak|chicken|pork|turkey|mushroom|truffle|gnocchi|penne|risotto|agnolotti)\b/.test(primary);
  if (!savoryPie && /\b(cake|cookies?|brownies?|cheesecake|pie|cobbler|crisp|pudding|tiramisu|ice cream|sundae|dessert|truffles?)\b/.test(primary)) return "dessert";
  if (!entreeWords.test(primary) && !/\bpot pie\b/.test(primary) && /\b(bread|biscuits?|muffins?|scones?|dinner rolls?)\b/.test(primary)) return "baked-good";
  if (/\b(snack|poppers?|bites?|trail mix)\b/.test(primary)) return "snack";
  if (/^(?:garlic )?(?:mashed potatoes|green beans|rice pilaf|roasted vegetables)$/.test(primary)) return "side";
  return "main";
}

export function inferCuisine(recipe) {
  const text = normalizedLookup(`${recipe.name} ${recipe.subName} ${(recipe.tags ?? []).join(" ")}`);
  const cuisines = [
    ["Mediterranean", /\bmediterranean\b/],
    ["Mexican", /\b(mexican|taco|fajita|enchilada|quesadilla|burrito)\w*\b/],
    ["Italian", /\b(italian|risotto|ravioli|tortellini|gnocchi|parmigiana|bruschetta)\w*\b/],
    ["Greek", /\b(greek|souvlaki|gyro|tzatziki)\w*\b/],
    ["Korean", /\b(korean|bulgogi|bibimbap|gochujang)\w*\b/],
    ["Thai", /\b(thai|pad thai)\b/],
    ["Indian", /\b(indian|tikka|masala|tandoori|korma)\w*\b/],
    ["Vietnamese", /\b(vietnamese|banh mi|pho)\b/],
    ["Japanese", /\b(japanese|teriyaki|yakitori|katsu|miso)\w*\b/],
    ["Chinese", /\b(chinese|szechuan|sichuan|kung pao)\b/],
    ["French", /\b(french|provencal|provençal|ratatouille)\b/],
    ["Middle Eastern", /\b(middle eastern|shawarma|falafel|za atar|harissa)\b/],
  ];
  return cuisines.find(([, pattern]) => pattern.test(text))?.[0];
}

function timerMinutesFromInstructions(instructions = []) {
  let total = 0;
  for (const instruction of instructions) {
    const text = String(instruction.text ?? "").toLowerCase();
    const stepDurations = [];
    for (const match of text.matchAll(/(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:minutes?|mins?)\b/g)) stepDurations.push(Number(match[2]));
    const withoutRanges = text.replace(/\d+\s*(?:-|–|to)\s*\d+\s*(?:minutes?|mins?)\b/g, "");
    for (const match of withoutRanges.matchAll(/(\d+)\s*(?:minutes?|mins?)\b/g)) stepDurations.push(Number(match[1]));
    if (stepDurations.length) total += Math.max(...stepDurations);
  }
  return total;
}

export function inferTimes(recipe) {
  let total = parseMinutes(recipe.totalTime);
  let prep = parseMinutes(recipe.prepTime);
  const inferred = [];
  if (prep === undefined) {
    prep = total !== undefined && total < 15 ? Math.min(5, total) : 10;
    inferred.push("prep_minutes");
  }
  if (total === undefined) {
    const timed = timerMinutesFromInstructions(recipe.instructions);
    total = Math.max(15, Math.ceil((prep + timed) / 5) * 5);
    inferred.push("total_minutes");
  }
  if (prep > total) {
    prep = total;
    inferred.push("prep_minutes_clamped");
  }
  return { times: { prep_minutes: prep, cook_minutes: Math.max(0, total - prep) }, inferred };
}

export function inferYield(recipe) {
  const text = `${recipe.subName ?? ""} ${(recipe.tags ?? []).join(" ")}`;
  const range = text.match(/\b([2-9])\s*(?:-|–|to)\s*([2-9]|1\d)\s*(?:servings?|portions?)\b/i);
  if (range) return { quantity: Number(range[2]), unit: "servings", inferred: true, reason: "source range" };
  const exact = text.match(/\b([2-9])\s*(?:servings?|portions?)\b/i);
  return exact
    ? { quantity: Number(exact[1]), unit: "servings", inferred: false }
    : { quantity: 2, unit: "servings", inferred: true, reason: "source omitted yield" };
}

function sourceAllergens(tags = []) {
  const found = new Set();
  for (const tag of tags) {
    const normalized = String(tag).toLowerCase().replace(/^contains\s+/, "").trim();
    const allergen = ALLERGEN_TAGS.get(normalized);
    if (allergen) found.add(allergen);
  }
  return found;
}

export function inferAllergens(recipe, ingredientRecords) {
  const found = sourceAllergens(recipe.tags);
  for (const ingredient of ingredientRecords) {
    for (const allergen of ingredient.allergens ?? inferIngredientAllergens(ingredient.name)) found.add(allergen);
  }
  return ALLERGEN_ORDER.filter((item) => found.has(item));
}

export function inferDietary(recipe, allergens, ingredientRecords = []) {
  const tags = new Set((recipe.tags ?? []).map((tag) => String(tag).toLowerCase()));
  const containsMeat = ingredientRecords.some((ingredient) => {
    const text = normalizedLookup(ingredient?.name ?? "");
    if (/\b(vegan|plant based)\b/.test(text) || /\b(steak spice|steak seasoning|steak sauce|beefsteak tomato)\b/.test(text)) return false;
    return /\b(chicken|beef|steak|pork|bacon|ham|turkey|duck|venison|lamb|sausage|prosciutto|salami|fish|salmon|trout|steelhead|cod|cobia|tilapia|tuna|halibut|barramundi|shrimp|prawn|scallop|lobster|crab|mussel|clam)\w*\b/.test(text);
  });
  const containsAnimalAllergen = ["milk", "eggs", "fish", "shellfish"].some((allergen) => allergens.includes(allergen));
  const dietary = new Set();
  if (tags.has("vegan") && !containsMeat && !containsAnimalAllergen) {
    dietary.add("vegan");
    dietary.add("vegetarian");
  } else if ((tags.has("vegan") || tags.has("veggie") || tags.has("vegetarian")) && !containsMeat) {
    dietary.add("vegetarian");
  }
  if ((tags.has("gluten-free") || tags.has("gluten free")) && !allergens.includes("wheat")) dietary.add("gluten-free");
  if (!allergens.includes("milk")) dietary.add("dairy-free");
  if (!allergens.includes("tree-nuts") && !allergens.includes("peanuts")) dietary.add("nut-free");
  if (!allergens.includes("eggs")) dietary.add("egg-free");
  return DIETARY_ORDER.filter((item) => dietary.has(item));
}

function meaningfulTags(recipe, mealType) {
  const excluded = new Set(["milk", "wheat", "soy", "eggs", "egg", "fish", "shellfish", "tree nuts", "tree-nuts", "peanuts", "peanut", "sesame", "veggie", "vegetarian", "vegan", "gluten-free", "gluten free", "new"]);
  const tags = [mealType, slug(recipe.difficulty), ...(recipe.tags ?? []).filter((tag) => !excluded.has(String(tag).toLowerCase().replace(/^contains\s+/, "").trim())).map((tag) => slug(tag)), "needs-review"];
  return [...new Set(tags.filter(Boolean))];
}

export function inferEquipment(recipe) {
  const text = (recipe.instructions ?? []).map((step) => step.text ?? "").join(" ").toLowerCase();
  const rules = [
    ["oven", /\boven\b/],
    ["baking sheet", /\bbaking sheet\b/],
    ["skillet", /\b(skillet|large pan|medium pan|frying pan)\b/],
    ["saucepan", /\b(saucepan|small pot|medium pot|large pot)\b/],
    ["grill", /\bgrill\b/],
    ["microwave", /\bmicrowave\b/],
    ["slow cooker", /\bslow cooker\b/],
    ["blender", /\bblender\b/],
    ["food processor", /\bfood processor\b/],
    ["colander", /\b(colander|drain)\b/],
  ];
  return rules.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

export function inferRecipeSeasons(recipe, lines, resolvedIngredients) {
  const scores = new Map(SEASON_ORDER.map((season) => [season, 0]));
  const allText = normalizedLookup(`${recipe.name} ${recipe.subName}`);
  const driverText = normalizedLookup(String(recipe.name ?? "").split(/\s+with\s+/i)[0]);
  for (const season of SEASON_ORDER) {
    const term = season === "fall" ? /\b(fall|autumn)\b/ : new RegExp(`\\b${season}\\b`);
    if (term.test(allText)) scores.set(season, scores.get(season) + 6);
  }
  for (const line of lines) {
    const ingredient = resolvedIngredients.get(normalizedLookup(cleanIngredientName(line.name).item));
    if (!ingredient || ingredient.seasons?.includes("year-round")) continue;
    const ingredientKey = normalizedLookup(ingredient.name);
    const weight = ingredientKey && driverText.includes(ingredientKey) ? 3 : 1;
    for (const season of ingredient.seasons ?? []) scores.set(season, scores.get(season) + weight);
  }
  if (/\b(soup|stew|chowder|chili|braise|pot pie)\w*\b/.test(allText)) {
    scores.set("fall", scores.get("fall") + 2);
    scores.set("winter", scores.get("winter") + 2);
  }
  if (/\b(grill|barbecue|barbeque|skewer|cold|chilled|spritz|no cook)\w*\b/.test(allText)) scores.set("summer", scores.get("summer") + 2);
  const max = Math.max(...scores.values());
  if (max < 2) return ["year-round"];
  const threshold = Math.max(2, max * 0.6);
  return SEASON_ORDER.filter((season) => scores.get(season) >= threshold);
}

function nutrition(recipe, audit) {
  const source = recipe.nutritionalValues ?? {};
  if (!Object.keys(source).length) return undefined;
  const limits = { calories: 5000, protein_g: 500, carbohydrates_g: 500, fat_g: 500, fiber_g: 200, sugar_g: 500, sodium_mg: 20000 };
  const result = { serving_size: "1 serving", source: "HelloFresh; imported factual data, verify before publishing" };
  const fields = [["Calories", "calories"], ["Protein", "protein_g"], ["Carbohydrate", "carbohydrates_g"], ["Fat", "fat_g"], ["Dietary Fiber", "fiber_g"], ["Sugar", "sugar_g"], ["Sodium", "sodium_mg"]];
  for (const [sourceKey, target] of fields) {
    const value = Number.parseFloat(source[sourceKey]?.amount);
    if (!Number.isFinite(value) || value < 0) continue;
    if (value > limits[target]) {
      audit.nutritionOutliers.push({ recipe_id: recipe.id, nutrient: sourceKey, value });
      continue;
    }
    result[target] = value;
  }
  return result;
}

function recipeLines(recipe, ingredientCatalog, audit) {
  return Object.entries(recipe.ingredients ?? {}).map(([rawName, value]) => {
    const { item, optional } = cleanIngredientName(rawName);
    const ingredient = ingredientCatalog.resolved.get(normalizedLookup(item));
    const normalized = normalizeQuantity(value?.amount, value?.unit);
    if (normalized.malformed) audit.malformedMeasurements.push({ recipe_id: recipe.id, ingredient: rawName, amount: value?.amount ?? "", unit: value?.unit ?? "" });
    if (normalized.missingUnit) audit.missingUnits.push({ recipe_id: recipe.id, ingredient: rawName, amount: value?.amount ?? "" });
    let quantity = normalized.quantity;
    if ((normalized.missing || normalized.malformed) && /^(?:kosher )?salt$|^(?:black )?pepper$/i.test(item)) {
      quantity = "to taste";
      audit.inferredMeasurements.push({ recipe_id: recipe.id, ingredient: rawName, quantity });
    } else if (normalized.missing) {
      audit.missingMeasurements.push({ recipe_id: recipe.id, ingredient: rawName });
    }
    return {
      ingredient_id: ingredient.id,
      item,
      ...(quantity !== undefined ? { quantity } : {}),
      ...(normalized.unit ? { unit: normalized.unit } : {}),
      ...(optional ? { optional: true } : {}),
    };
  });
}

export function transformMeals({ selectedRecipes, allRecipes = selectedRecipes, existingIngredients = [], hemisphere = "northern" }) {
  if (!Array.isArray(selectedRecipes) || !Array.isArray(allRecipes)) throw new TypeError("Recipe input must be an array.");
  if (!new Set(["northern", "southern"]).has(hemisphere)) throw new Error(`Unsupported hemisphere '${hemisphere}'.`);
  const ingredientCatalog = buildIngredientCatalog(selectedRecipes, existingIngredients, hemisphere);
  const recipeIds = buildRecipeIdMap(allRecipes);
  const audit = {
    inferredPrepTime: [],
    inferredTotalTime: [],
    assumedYield: [],
    missingSourceTags: [],
    missingSubtitles: [],
    titleArtifacts: [],
    duplicateTitles: [],
    missingNutrition: [],
    dietaryConflicts: [],
    malformedMeasurements: [],
    missingMeasurements: [],
    missingUnits: [],
    inferredMeasurements: [],
    nutritionOutliers: [],
    fallbackSeasonIngredients: ingredientCatalog.fallbackSeasonIngredients,
  };
  const titleGroups = new Map();
  for (const recipe of selectedRecipes) {
    const key = normalizedLookup(recipe.name);
    if (!titleGroups.has(key)) titleGroups.set(key, []);
    titleGroups.get(key).push(recipe.id);
  }
  audit.duplicateTitles = [...titleGroups.entries()]
    .filter(([, source_ids]) => source_ids.length > 1)
    .map(([normalized_title, source_ids]) => ({ normalized_title, source_ids }));
  const recipes = [];
  const destinations = {};

  for (const sourceRecipe of selectedRecipes) {
    if (!(sourceRecipe.tags?.length)) audit.missingSourceTags.push(sourceRecipe.id);
    if (!sourceRecipe.subName) audit.missingSubtitles.push(sourceRecipe.id);
    if (/^(?:\d{4}-w\d+|r\d+)\b/i.test(sourceRecipe.name ?? "") || /^[^a-z]*[A-Z][^a-z]*$/.test(sourceRecipe.name ?? "")) {
      audit.titleArtifacts.push({ recipe_id: sourceRecipe.id, name: sourceRecipe.name });
    }
    const mealType = inferMealType(sourceRecipe);
    const id = recipeIds.get(sourceRecipe.id);
    const lines = recipeLines(sourceRecipe, ingredientCatalog, audit);
    const ingredientRecords = lines.map((line) => ingredientCatalog.resolved.get(normalizedLookup(line.item)));
    const allergens = inferAllergens(sourceRecipe, ingredientRecords);
    const dietary = inferDietary(sourceRecipe, allergens, ingredientRecords);
    const sourceTags = new Set((sourceRecipe.tags ?? []).map((tag) => String(tag).toLowerCase()));
    if (sourceTags.has("vegan") && !dietary.includes("vegan")) audit.dietaryConflicts.push({ recipe_id: sourceRecipe.id, source_tag: "Vegan" });
    if ((sourceTags.has("veggie") || sourceTags.has("vegetarian")) && !dietary.includes("vegetarian")) audit.dietaryConflicts.push({ recipe_id: sourceRecipe.id, source_tag: "Veggie" });
    if ((sourceTags.has("gluten-free") || sourceTags.has("gluten free")) && !dietary.includes("gluten-free")) audit.dietaryConflicts.push({ recipe_id: sourceRecipe.id, source_tag: "Gluten-free" });
    const seasons = inferRecipeSeasons(sourceRecipe, Object.keys(sourceRecipe.ingredients ?? {}).map((name) => ({ name })), ingredientCatalog.resolved);
    const { times, inferred } = inferTimes(sourceRecipe);
    if (inferred.includes("prep_minutes")) audit.inferredPrepTime.push(sourceRecipe.id);
    if (inferred.includes("total_minutes")) audit.inferredTotalTime.push(sourceRecipe.id);
    const recipeYield = inferYield(sourceRecipe);
    if (recipeYield.inferred) audit.assumedYield.push(sourceRecipe.id);
    const recipeNutrition = nutrition(sourceRecipe, audit);
    if (!recipeNutrition) audit.missingNutrition.push(sourceRecipe.id);
    const cuisine = inferCuisine(sourceRecipe);
    const equipment = inferEquipment(sourceRecipe);
    const notes = [
      "Instructions are intentionally withheld from this review draft; replace every REWRITE REQUIRED step with original concise directions before promotion.",
      "Classification, seasonality, dietary, allergen, and equipment metadata were inferred and require review.",
      ...(recipeYield.inferred ? [`Yield is estimated at ${recipeYield.quantity} servings because ${recipeYield.reason === "source range" ? "the source gives a serving range" : "the source record does not specify one"}.`] : []),
      ...(inferred.includes("prep_minutes") ? [`Prep time was inferred as ${times.prep_minutes} minutes because the source record does not specify it.`] : []),
      ...(inferred.includes("total_minutes") ? [`Total time was estimated as ${times.prep_minutes + times.cook_minutes} minutes from the source steps because the source record does not specify it.`] : []),
      ...(!recipeNutrition ? ["The source record does not include nutrition data."] : []),
    ];
    const instructionCount = Math.max(1, sourceRecipe.instructions?.length ?? 0);
    const data = {
      $schema: "../../schemas/recipe.schema.json",
      schema_version: "1.0.0",
      id,
      name: sourceRecipe.name || `Legacy recipe ${sourceRecipe.id}`,
      ...(sourceRecipe.subName ? { subtitle: sourceRecipe.subName } : {}),
      meal_type: mealType,
      ...(cuisine ? { cuisine } : {}),
      yield: { quantity: recipeYield.quantity, unit: recipeYield.unit },
      times,
      ingredients: lines,
      instructions: Array.from({ length: instructionCount }, (_, index) => ({
        step: index + 1,
        text: `REWRITE REQUIRED: Replace source step ${index + 1} with an original, concise cooking direction before promotion.`,
      })),
      ...(recipeNutrition ? { nutrition: recipeNutrition } : {}),
      tags: meaningfulTags(sourceRecipe, mealType),
      seasons,
      ...(dietary.length ? { dietary } : {}),
      ...(allergens.length ? { allergens } : {}),
      ...(equipment.length ? { equipment } : {}),
      notes,
      source: { name: "HelloFresh", url: sourceRecipe.url, adapted: true },
    };
    const folder = FOLDER_BY_TYPE[mealType] ?? mealType;
    recipes.push({ folder, data });
    destinations[id] = folder;
  }
  return { recipes, ingredients: ingredientCatalog.candidates, destinations, audit };
}
