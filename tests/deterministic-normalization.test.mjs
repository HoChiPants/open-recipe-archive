import assert from "node:assert/strict";
import test from "node:test";

import {
  deterministicPublicationReview,
  deterministicRecipeFacts,
  deterministicReviewDisposition,
  parseIngredientLine,
} from "../scripts/deterministic-normalization-lib.mjs";

const candidate = {
  candidate_version: "1.0.0",
  review_status: "needs-review-and-original-wording",
  source: { name: "Example", url: "https://example.com/tomato-salad" },
  extracted: {
    name: "Tomato Salad",
    description: "A promotional source description.",
    yield: { quantity: 4, unit: "servings" },
    times: { prep_minutes: 10, cook_minutes: 0, inactive_minutes: 5 },
    ingredient_lines: ["2 large tomatoes, cut into wedges", "1½ tablespoons chopped fresh basil", "350g feta, crumbled"],
    instruction_lines: ["Combine the tomatoes and basil; chill for 5 minutes, then serve."],
    categories: ["Lunch", "Salad", "Italian"],
  },
};

test("parses common quantities without a model call", () => {
  assert.deepEqual(parseIngredientLine("1 (14 ounce) can sweetened condensed milk"), {
    item: "sweetened condensed milk", quantity: "1", unit: "can", preparation: "14 ounce", optional: false,
  });
  assert.deepEqual(parseIngredientLine("350g plums, halved and destoned"), {
    item: "plums", quantity: "350", unit: "g", preparation: "halved and destoned", optional: false,
  });
  assert.deepEqual(parseIngredientLine("½ cinnamon stick"), {
    item: "cinnamon stick", quantity: "1/2", unit: "", preparation: "", optional: false,
  });
});

test("extracts structured recipe facts deterministically", () => {
  const facts = deterministicRecipeFacts(candidate);
  assert.equal(facts.status, "usable");
  assert.equal(facts.meal_type, "salad");
  assert.equal(facts.cuisine, "Italian");
  assert.deepEqual(facts.yield, { quantity: 4, unit: "servings" });
  assert.deepEqual(facts.times, { prep_minutes: 10, cook_minutes: 0, inactive_minutes: 5 });
  assert.deepEqual(facts.ingredients.map(({ item, quantity, unit }) => ({ item, quantity, unit })), [
    { item: "tomatoes", quantity: "2", unit: "large" },
    { item: "fresh basil", quantity: "1 1/2", unit: "tablespoons" },
    { item: "feta", quantity: "350", unit: "g" },
  ]);
  assert.ok(facts.operations.some((operation) => operation.action === "combine"));
  assert.ok(facts.operations.some((operation) => operation.action === "chill" && operation.duration_minutes === 5));
});

test("skips incomplete candidates before spending model usage", () => {
  const incomplete = structuredClone(candidate);
  incomplete.extracted.instruction_lines = [];
  const facts = deterministicRecipeFacts(incomplete);
  assert.equal(facts.status, "skip");
  assert.match(facts.reason, /missing/i);
});

test("passes clear local reviews and escalates only borderline similarity", () => {
  const recipe = { name: "Tomato Salad", instructions: [{ text: "Fold the vegetables together and chill." }] };
  const clearSimilarity = { prose_trigram_jaccard_percent: 8, max_step_trigram_jaccard_percent: 15 };
  const clear = deterministicReviewDisposition(candidate, recipe, clearSimilarity, []);
  assert.equal(clear.mode, "pass");
  assert.equal(deterministicPublicationReview(candidate, recipe, clearSimilarity, clear).decision, "pass");

  const borderline = deterministicReviewDisposition(candidate, recipe, {
    prose_trigram_jaccard_percent: 25, max_step_trigram_jaccard_percent: 40,
  }, []);
  assert.equal(borderline.mode, "model");

  const high = deterministicReviewDisposition(candidate, recipe, {
    prose_trigram_jaccard_percent: 55, max_step_trigram_jaccard_percent: 75,
  }, []);
  assert.equal(high.mode, "hold");
});
