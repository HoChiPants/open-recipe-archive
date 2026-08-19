import assert from "node:assert/strict";
import test from "node:test";
import {
  automaticReviewReasons,
  materializeRecipe,
  proseMetrics,
  uniqueRecipeId,
} from "../scripts/recipe-pipeline-lib.mjs";
import {
  detectedBrandTerms,
  deterministicSimilarity,
  normalizeHostname,
  publicationReviewReasons,
  publicationRightsIssues,
} from "../scripts/publication-review-lib.mjs";

const candidate = {
  source: { name: "Example", url: "https://example.com/salad" },
  extracted: {
    description: "A long promotional description with several unnecessary descriptive words.",
    instruction_lines: ["Mix every ingredient in a bowl and serve the salad immediately."],
  },
};

const generated = {
  status: "promote",
  reason: "Complete low-risk recipe",
  confidence: 94,
  variation_changes: ["Added fresh basil"],
  recipe: {
    name: "Lemon tomato salad",
    subtitle: "Fresh tomatoes in a lemon dressing",
    description: "A quick chopped salad for summer.",
    meal_type: "salad",
    cuisine: "",
    yield: { quantity: 4, unit: "servings" },
    times: { prep_minutes: 10, cook_minutes: 0, inactive_minutes: 0 },
    ingredients: [
      { item: "tomato", quantity: "4", unit: "", preparation: "chopped", optional: false },
      { item: "lemon juice", quantity: "2", unit: "tablespoons", preparation: "", optional: false },
      { item: "fresh basil", quantity: "2", unit: "tablespoons", preparation: "chopped", optional: false },
    ],
    instructions: [{ text: "Fold the tomatoes through the lemon juice and serve.", timer_minutes: 0 }],
    tags: ["Quick", "summer salad"],
    seasons: ["summer"],
    dietary: ["vegetarian", "vegan"],
    allergens: [],
    equipment: ["mixing bowl"],
  },
};

test("materializes model output as a canonical recipe record", () => {
  const recipe = materializeRecipe(candidate, generated, new Set(), [{ id: "tomato", name: "tomato", aliases: [] }]);
  assert.equal(recipe.id, "lemon-tomato-salad");
  assert.equal(recipe.ingredients[0].ingredient_id, "tomato");
  assert.deepEqual(recipe.tags, ["quick", "summer-salad"]);
  assert.equal(recipe.source.url, candidate.source.url);
  assert.equal(recipe.source.adapted, true);
  assert.equal(recipe.instructions[0].timer_minutes, undefined);
});

test("uses a deterministic suffix when a generated ID already exists", () => {
  const id = uniqueRecipeId("Lemon tomato salad", candidate.source.url, new Set(["lemon-tomato-salad"]));
  assert.match(id, /^lemon-tomato-salad-[a-f0-9]{8}$/);
});

test("holds risky or contradictory recipes out of automatic promotion", () => {
  const recipe = materializeRecipe(candidate, generated, new Set());
  recipe.ingredients.push({ item: "chicken breast", quantity: 1, unit: "pound" });
  recipe.dietary = ["vegan"];
  recipe.allergens = ["milk"];
  const reasons = automaticReviewReasons({ status: "usable", reason: "", base_name: "Tomato salad", ingredients: [], safety_flags: [] }, generated, recipe);
  assert.ok(reasons.some((reason) => reason.includes("high-risk")));
  assert.ok(reasons.some((reason) => reason.includes("vegan conflicts")));
});

test("records source-to-final prose analytics without treating them as legal clearance", () => {
  const recipe = materializeRecipe(candidate, generated, new Set());
  const metrics = proseMetrics(candidate, recipe);
  assert.ok(metrics.source_word_count > 0);
  assert.ok(metrics.final_word_count > 0);
  assert.equal(typeof metrics.final_word_count_change_percent, "number");
});

test("detects close instruction structure and configured brand terms", () => {
  const recipe = materializeRecipe(candidate, generated, new Set());
  recipe.instructions = [{ step: 1, text: "Mix every ingredient in a bowl and serve the salad immediately." }];
  recipe.name = "Instant Pot copycat tomato salad";
  const similarity = deterministicSimilarity(candidate, recipe);
  const brands = detectedBrandTerms(candidate, recipe, {
    terms: [{ term: "Instant Pot", generic: "electric pressure cooker" }],
  });
  assert.equal(similarity.max_step_trigram_jaccard_percent, 100);
  assert.deepEqual(brands.map((item) => item.term), ["Instant Pot", "copycat"]);
});

test("turns independent publication-review warnings into automatic holds", () => {
  const reasons = publicationReviewReasons({
    decision: "hold",
    confidence: 92,
    copyright_risk: "medium",
    semantic_similarity: 70,
    structural_similarity: 40,
    distinctive_expression_matches: ["distinctive serving phrase"],
    likely_brand_terms: ["Example Brand"],
    trademark_risk: "medium",
    title_is_generic: false,
    implied_affiliation: true,
    reasons: ["Close paraphrase and branded title"],
  }, {
    prose_trigram_jaccard_percent: 10,
    max_step_trigram_jaccard_percent: 20,
  }, [], 80);
  assert.ok(reasons.some((reason) => reason.includes("semantic similarity")));
  assert.ok(reasons.some((reason) => reason.includes("brand terms")));
  assert.ok(reasons.some((reason) => reason.includes("affiliation")));
});

test("requires a current reusable rights record and applies source caps", () => {
  const policy = {
    review_after_days: 365,
    collection: { max_source_share_percent: 90, minimum_catalog_size_for_share_gate: 20 },
    sources: {
      "example.com": {
        status: "approved",
        basis: "written-permission",
        evidence: "agreement-123",
        reviewed_at: "2026-08-01",
        expires_at: "",
        max_per_run: 1,
        max_catalog_recipes: 2,
        notes: "",
      },
    },
  };
  assert.equal(normalizeHostname("WWW.Example.com"), "example.com");
  assert.deepEqual(publicationRightsIssues(candidate, policy, [], new Map(), new Date("2026-08-18T00:00:00Z")), []);
  const capped = publicationRightsIssues(candidate, policy, [], new Map([["example.com", 1]]), new Date("2026-08-18T00:00:00Z"));
  assert.ok(capped.some((reason) => reason.includes("per-run cap")));
  const stale = structuredClone(policy);
  stale.sources["example.com"].reviewed_at = "2024-01-01";
  assert.ok(publicationRightsIssues(candidate, stale, [], new Map(), new Date("2026-08-18T00:00:00Z")).some((reason) => reason.includes("days old")));

  const concentratedCatalog = [
    ...Array.from({ length: 7 }, (_, index) => ({ id: `example-${index}`, source: { url: `https://example.com/${index}` } })),
    ...Array.from({ length: 12 }, (_, index) => ({ id: `other-${index}`, source: { url: `https://other.test/${index}` } })),
  ];
  const concentrated = structuredClone(policy);
  concentrated.collection.max_source_share_percent = 35;
  concentrated.sources["example.com"].max_catalog_recipes = 0;
  assert.ok(publicationRightsIssues(candidate, concentrated, concentratedCatalog, new Map(), new Date("2026-08-18T00:00:00Z")).some((reason) => reason.includes("collection cap")));
});
