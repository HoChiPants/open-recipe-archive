const copiedPhraseLength = 8;

function words(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g) ?? [];
}

function phrases(value, length = copiedPhraseLength) {
  const tokens = words(value);
  const result = new Set();
  for (let index = 0; index <= tokens.length - length; index += 1) {
    result.add(tokens.slice(index, index + length).join(" "));
  }
  return result;
}

export function copiedSourcePhrase(candidate, recipe, length = copiedPhraseLength) {
  const sourceText = [
    candidate?.extracted?.description,
    ...(candidate?.extracted?.instruction_lines ?? []),
  ].join("\n");
  const recipeText = [
    recipe?.subtitle,
    recipe?.description,
    ...(recipe?.instructions ?? []).map((instruction) => instruction.text),
    ...(recipe?.notes ?? []),
  ].join("\n");
  const sourcePhrases = phrases(sourceText, length);
  return [...phrases(recipeText, length)].find((phrase) => sourcePhrases.has(phrase)) ?? null;
}

export function candidatePromotionIssues(candidate, recipe) {
  const issues = [];
  if (candidate?.candidate_version !== "1.0.0" || candidate?.review_status !== "needs-review-and-original-wording") {
    issues.push("input is not a supported review candidate");
  }
  if (!candidate?.source?.url) issues.push("candidate is missing its source URL");
  if (!recipe?.source?.url || recipe.source.url !== candidate?.source?.url) {
    issues.push("final recipe must retain the candidate source URL");
  }
  if (recipe?.source?.adapted !== true) issues.push("final recipe source must set adapted to true");
  if ((recipe?.tags ?? []).includes("needs-review")) issues.push("final recipe still has the needs-review tag");
  if (JSON.stringify(recipe).includes("REWRITE REQUIRED")) issues.push("final recipe still contains a rewrite placeholder");
  const copiedPhrase = copiedSourcePhrase(candidate, recipe);
  if (copiedPhrase) issues.push(`final prose repeats source wording: "${copiedPhrase}"`);
  return issues;
}
