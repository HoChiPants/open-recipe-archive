import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { root } from "./library.mjs";
import { normalizedTextHash, sourceTextHash } from "./recipe-pipeline-lib.mjs";

export const stagedNormalizationRoot = path.join(root, "work", "recipe-pipeline", "staged");

export function stagedFileForCandidate(candidateFile) {
  const candidateRoot = path.join(root, "scraping", "output");
  const relativeCandidate = path.relative(candidateRoot, path.resolve(candidateFile));
  if (!relativeCandidate || relativeCandidate.startsWith("..") || path.isAbsolute(relativeCandidate)) {
    throw new Error("staged candidates must be inside scraping/output");
  }
  return path.join(stagedNormalizationRoot, relativeCandidate);
}

export async function writeStagedNormalization(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryFile, file);
}

export function stagedNormalizationIssues(stage, candidate) {
  const issues = [];
  if (stage.schema_version !== "1.0.0") issues.push("unsupported staged normalization schema version");
  if (stage.candidate_file?.startsWith("scraping/output/") !== true) issues.push("invalid staged candidate path");
  if (stage.content_reasons?.length) issues.push(...stage.content_reasons);
  if (!stage.recipe?.normalization) issues.push("missing normalization provenance");
  if (stage.recipe?.normalization?.requires_review) issues.push("normalization requires human review");
  if (stage.recipe?.normalization?.source_review_status !== "passed") issues.push("normalization source review did not pass");
  if (candidate && stage.recipe?.normalization?.source_text_hash !== sourceTextHash(candidate)) {
    issues.push("source expressive text changed after staging");
  }
  if (stage.recipe && stage.recipe?.normalization?.normalized_text_hash !== normalizedTextHash(stage.recipe)) {
    issues.push("staged normalized expressive text hash does not match");
  }
  return [...new Set(issues)];
}

export function stagedCacheIssues(stage, candidate, { pipelineVersion, model }) {
  const issues = [];
  if (!stage || stage.schema_version !== "1.0.0") issues.push("unsupported staged normalization schema version");
  if (stage?.pipeline_version !== pipelineVersion) issues.push("staged pipeline version changed");
  if (stage?.model !== model) issues.push("staged model changed");
  if (stage?.recipe?.normalization?.prompt_version !== pipelineVersion) issues.push("staged prompt version changed");
  if (stage?.recipe?.normalization?.source_text_hash !== sourceTextHash(candidate)) issues.push("source expressive text changed after staging");
  if (stage?.recipe && stage.recipe.normalization?.normalized_text_hash !== normalizedTextHash(stage.recipe)) {
    issues.push("staged normalized expressive text hash does not match");
  }
  return [...new Set(issues)];
}
