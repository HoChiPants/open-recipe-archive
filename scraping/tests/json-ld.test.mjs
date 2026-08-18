import assert from "node:assert/strict";
import test from "node:test";
import { extractJsonLd } from "../src/adapters/json-ld.mjs";
import { normalizeCandidate } from "../src/core/normalize.mjs";

test("extracts and normalizes a Schema.org Recipe", () => {
  const html = `<script type=application/ld+json>${JSON.stringify({
    "@context": "https://schema.org", "@type": "Recipe", name: "Test Soup", description: "Fast&nbsp;&amp; easy&#33;",
    prepTime: "PT10M", cookTime: "PT30M", totalTime: "PT45M", recipeYield: "4 bowls",
    recipeIngredient: ["2 cups broth"], recipeInstructions: [{ "@type": "HowToStep", text: "Simmer gently.&#039;" }]
  })}</script>`;
  const raw = extractJsonLd(html)[0];
  const candidate = normalizeCandidate(raw, "https://example.com/recipes/soup", { name: "Example" });
  assert.equal(candidate.extracted.name, "Test Soup");
  assert.equal(candidate.extracted.description, "Fast & easy!");
  assert.deepEqual(candidate.extracted.times, { prep_minutes: 10, cook_minutes: 30, inactive_minutes: 5 });
  assert.equal(candidate.extracted.yield.quantity, 4);
  assert.deepEqual(candidate.extracted.instruction_lines, ["Simmer gently.'"]);
});

test("normalizes serving ranges without treating the upper bound as a unit", () => {
  const candidate = normalizeCandidate({ "@type": "Recipe", name: "Range", recipeYield: "4-6+" }, "https://example.com/range", { name: "Example" });
  assert.deepEqual(candidate.extracted.yield, { quantity: 4, unit: "servings" });
});
