import assert from "node:assert/strict";
import test from "node:test";
import { candidatePromotionIssues, copiedSourcePhrase } from "../scripts/promote-candidate-lib.mjs";

const candidate = {
  candidate_version: "1.0.0",
  review_status: "needs-review-and-original-wording",
  source: { name: "Example", url: "https://example.com/recipe" },
  extracted: {
    description: "A bright and creamy bowl for a relaxed summer lunch.",
    instruction_lines: ["Whisk the dressing in a large bowl, then gently fold in the remaining ingredients."],
  },
};

function recipe(overrides = {}) {
  return {
    source: { name: "Example", url: candidate.source.url, adapted: true },
    tags: ["salad"],
    instructions: [{ step: 1, text: "Stir the vinaigrette together before adding the vegetables." }],
    ...overrides,
  };
}

test("candidate promotion accepts independently written prose with its source retained", () => {
  assert.deepEqual(candidatePromotionIssues(candidate, recipe()), []);
});

test("candidate promotion rejects missing attribution and review placeholders", () => {
  const issues = candidatePromotionIssues(candidate, recipe({
    source: { name: "Example", adapted: false },
    tags: ["needs-review"],
    instructions: [{ step: 1, text: "REWRITE REQUIRED" }],
  }));
  assert.ok(issues.some((issue) => issue.includes("source URL")));
  assert.ok(issues.some((issue) => issue.includes("adapted")));
  assert.ok(issues.some((issue) => issue.includes("needs-review")));
  assert.ok(issues.some((issue) => issue.includes("placeholder")));
});

test("candidate promotion catches long copied phrases", () => {
  const copied = recipe({ instructions: [{ step: 1, text: candidate.extracted.instruction_lines[0] }] });
  assert.equal(copiedSourcePhrase(candidate, copied), "whisk the dressing in a large bowl then");
  assert.ok(candidatePromotionIssues(candidate, copied).some((issue) => issue.includes("repeats source wording")));
});
