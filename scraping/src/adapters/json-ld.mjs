function recipeNodes(value, found = []) {
  if (!value || typeof value !== "object") return found;
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (types.some((type) => String(type).toLowerCase() === "recipe")) found.push(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => recipeNodes(item, found));
    else if (child && typeof child === "object") recipeNodes(child, found);
  }
  return found;
}

export function extractJsonLd(html) {
  const recipes = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { recipes.push(...recipeNodes(JSON.parse(match[1].trim()))); } catch { /* invalid publisher JSON-LD */ }
  }
  return recipes;
}
