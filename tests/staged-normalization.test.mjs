import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { normalizationProvenance } from "../scripts/recipe-pipeline-lib.mjs";
import { stagedCacheIssues, stagedFileForCandidate, stagedNormalizationIssues } from "../scripts/staged-normalization-lib.mjs";

const candidate = {
  source: { url: "https://example.com/salad" },
  extracted: { description: "Source description", instruction_lines: ["Mix and serve."] },
};
const recipe = {
  description: "A concise salad.",
  instructions: [{ text: "Fold together, then serve." }],
};
const review = { semantic_similarity: 30, structural_similarity: 25 };

function stageFixture() {
  const normalization = normalizationProvenance(candidate, recipe, review, {
    model: "gpt-5.3-codex-spark", promptVersion: "3.0.0", transformedAt: "2026-09-01T00:00:00.000Z",
  });
  return {
    schema_version: "1.0.0",
    pipeline_version: "3.0.0",
    model: "gpt-5.3-codex-spark",
    candidate_file: "scraping/output/example/salad.json",
    content_reasons: [],
    recipe: { ...recipe, normalization },
  };
}

test("uses a stable staged path under the candidate's site", () => {
  assert.equal(
    path.relative(process.cwd(), stagedFileForCandidate(path.join(process.cwd(), "scraping/output/example/salad.json"))),
    "work/recipe-pipeline/staged/example/salad.json",
  );
});

test("reuses only unchanged stages from the same pipeline and model", () => {
  const stage = stageFixture();
  assert.deepEqual(stagedCacheIssues(stage, candidate, {
    pipelineVersion: "3.0.0", model: "gpt-5.3-codex-spark",
  }), []);
  assert.ok(stagedCacheIssues(stage, candidate, {
    pipelineVersion: "3.1.0", model: "gpt-5.3-codex-spark",
  }).some((issue) => issue.includes("pipeline version")));
});

test("accepts an unchanged passed staged normalization", () => {
  assert.deepEqual(stagedNormalizationIssues(stageFixture(), candidate), []);
});

test("holds changed source text and review-required stages", () => {
  const stage = stageFixture();
  stage.recipe.normalization.requires_review = true;
  stage.recipe.normalization.source_review_status = "needs-review";
  const changed = structuredClone(candidate);
  changed.extracted.description = "Changed source";
  const issues = stagedNormalizationIssues(stage, changed);
  assert.ok(issues.some((issue) => issue.includes("human review")));
  assert.ok(issues.some((issue) => issue.includes("changed after staging")));
});
