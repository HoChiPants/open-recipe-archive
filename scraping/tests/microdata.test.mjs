import assert from "node:assert/strict";
import test from "node:test";
import { extractMicrodata } from "../src/adapters/microdata.mjs";
import { normalizeCandidate } from "../src/core/normalize.mjs";

test("extracts and normalizes a Schema.org microdata Recipe", () => {
  const html = `
    <div itemscope itemtype="https://schema.org/Recipe">
      <div itemprop="author"><meta itemprop="name" content="Test Cook"></div>
      <meta itemprop="name" content="Test Stew">
      <meta itemprop="mainEntityOfPage" content="https://example.com/stew">
      <meta itemprop="description" content="Fast &amp; filling">
      <meta itemprop="recipeYield" content="4 bowls">
      <span itemprop="prepTime" content="PT10M">10 minutes</span>
      <span itemprop="cookTime" content="PT20M">20 minutes</span>
      <meta itemprop="totalTime" content="PT35M">
      <li itemprop="recipeIngredient">2 cups <b>broth</b></li>
      <ol itemprop="recipeInstructions"><li>Stir <strong>well</strong>.</li><li>Simmer.</li></ol>
    </div>`;
  const raw = extractMicrodata(html)[0];
  const candidate = normalizeCandidate(raw, "https://example.com/stew", { name: "Example" });
  assert.equal(candidate.extracted.name, "Test Stew");
  assert.equal(candidate.extracted.description, "Fast & filling");
  assert.deepEqual(candidate.extracted.ingredient_lines, ["2 cups broth"]);
  assert.deepEqual(candidate.extracted.instruction_lines, ["Stir well.", "Simmer."]);
  assert.deepEqual(candidate.extracted.times, { prep_minutes: 10, cook_minutes: 20, inactive_minutes: 5 });
});
