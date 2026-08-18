function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function hasItemprop(tag, name) {
  return String(attribute(tag, "itemprop") || "").split(/\s+/).includes(name);
}

function valuesForItemprop(html, name) {
  const values = [];
  for (const match of html.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)) {
    const tag = match[0];
    if (!hasItemprop(tag, name)) continue;
    const content = attribute(tag, "content");
    if (content !== undefined) {
      values.push({ index: match.index, value: content });
      continue;
    }
    const closing = new RegExp(`<\\/${match[1]}\\s*>`, "ig");
    closing.lastIndex = match.index + tag.length;
    const end = closing.exec(html);
    if (end) values.push({ index: match.index, value: html.slice(match.index + tag.length, end.index) });
  }
  return values;
}

function instructionValues(html) {
  const container = valuesForItemprop(html, "recipeInstructions")[0]?.value;
  if (!container) return [];
  const items = [...container.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => match[1]);
  return items.length ? items : [container];
}

function firstValue(html, name) {
  return valuesForItemprop(html, name)[0]?.value;
}

export function extractMicrodata(html) {
  const recipeStart = html.search(/<[^>]+itemscope\b[^>]*itemtype\s*=\s*["']https?:\/\/schema\.org\/Recipe["'][^>]*>/i);
  if (recipeStart < 0) return [];
  const recipe = html.slice(recipeStart);
  const mainEntityIndex = valuesForItemprop(recipe, "mainEntityOfPage")[0]?.index ?? Infinity;
  const names = valuesForItemprop(recipe, "name");
  const name = names.filter((entry) => entry.index < mainEntityIndex).at(-1)?.value ?? names[0]?.value;
  const ingredients = [...new Set(valuesForItemprop(recipe, "recipeIngredient").map((entry) => entry.value))];
  const instructions = instructionValues(recipe);
  if (!name || !ingredients.length || !instructions.length) return [];

  return [{
    "@type": "Recipe",
    name,
    description: firstValue(recipe, "description"),
    recipeYield: firstValue(recipe, "recipeYield"),
    prepTime: firstValue(recipe, "prepTime"),
    cookTime: firstValue(recipe, "cookTime"),
    totalTime: firstValue(recipe, "totalTime"),
    recipeIngredient: ingredients,
    recipeInstructions: instructions,
    recipeCategory: firstValue(recipe, "recipeCategory"),
    recipeCuisine: firstValue(recipe, "recipeCuisine")
  }];
}
