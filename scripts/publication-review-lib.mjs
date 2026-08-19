function tokens(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g) ?? [];
}

function ngrams(value, size) {
  const words = Array.isArray(value) ? value : tokens(value);
  const result = new Set();
  for (let index = 0; index <= words.length - size; index += 1) {
    result.add(words.slice(index, index + size).join(" "));
  }
  return result;
}

function setJaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function percent(value) {
  return Math.round(value * 1000) / 10;
}

function sourceProse(candidate) {
  return [candidate?.extracted?.description, ...(candidate?.extracted?.instruction_lines ?? [])]
    .filter(Boolean)
    .join(" ");
}

function finalProse(recipe) {
  return [recipe?.subtitle, recipe?.description, ...(recipe?.instructions ?? []).map((item) => item.text)]
    .filter(Boolean)
    .join(" ");
}

function contentText(recipe) {
  return [
    recipe?.name,
    recipe?.subtitle,
    recipe?.description,
    ...(recipe?.ingredients ?? []).map((item) => `${item.item} ${item.preparation ?? ""}`),
    ...(recipe?.instructions ?? []).map((item) => item.text),
    ...(recipe?.tags ?? []),
  ].filter(Boolean).join(" ");
}

export function normalizeHostname(url) {
  try {
    const value = String(url || "").trim();
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function deterministicSimilarity(candidate, recipe) {
  const source = sourceProse(candidate);
  const final = finalProse(recipe);
  const sourceSteps = candidate?.extracted?.instruction_lines ?? [];
  const finalSteps = (recipe?.instructions ?? []).map((item) => item.text);
  let maxStepTrigram = 0;
  for (const sourceStep of sourceSteps) {
    for (const finalStep of finalSteps) {
      maxStepTrigram = Math.max(maxStepTrigram, setJaccard(ngrams(sourceStep, 3), ngrams(finalStep, 3)));
    }
  }
  return {
    prose_trigram_jaccard_percent: percent(setJaccard(ngrams(source, 3), ngrams(final, 3))),
    max_step_trigram_jaccard_percent: percent(maxStepTrigram),
    source_instruction_count: sourceSteps.length,
    final_instruction_count: finalSteps.length,
  };
}

export function detectedBrandTerms(candidate, recipe, brandPolicy) {
  const text = contentText(recipe);
  const normalized = ` ${tokens(text).join(" ")} `;
  const matches = [];
  for (const entry of brandPolicy?.terms ?? []) {
    const term = tokens(entry.term).join(" ");
    if (term && normalized.includes(` ${term} `)) matches.push({ term: entry.term, generic: entry.generic });
  }

  const publisher = String(candidate?.source?.name || "").trim();
  const publisherTokens = tokens(publisher).join(" ");
  if (publisherTokens && publisherTokens.length >= 4 && normalized.includes(` ${publisherTokens} `)) {
    matches.push({ term: publisher, generic: "publisher name" });
  }
  if (/[®™]/u.test(text)) matches.push({ term: "®/™ symbol", generic: "generic product name" });
  if (/\bcopycat\b/i.test(text)) matches.push({ term: "copycat", generic: "generic recipe title" });
  return [...new Map(matches.map((match) => [match.term.toLowerCase(), match])).values()];
}

export function publicationReviewReasons(review, similarity, brandMatches, minimumConfidence = 80) {
  const reasons = [];
  if (review.decision !== "pass") reasons.push(`independent publication review held the recipe: ${review.reasons.join("; ") || "unspecified concern"}`);
  if (review.confidence < minimumConfidence) reasons.push(`publication-review confidence ${review.confidence} is below ${minimumConfidence}`);
  if (review.copyright_risk !== "low") reasons.push(`publication review found ${review.copyright_risk} expression-copying risk`);
  if (review.semantic_similarity >= 65) reasons.push(`semantic similarity ${review.semantic_similarity}% is too high`);
  if (review.structural_similarity >= 75) reasons.push(`instruction-structure similarity ${review.structural_similarity}% is too high`);
  if (review.distinctive_expression_matches.length) reasons.push(`possible distinctive expression overlap: ${review.distinctive_expression_matches.join(" | ")}`);
  if (review.likely_brand_terms.length) reasons.push(`publication review found possible brand terms: ${review.likely_brand_terms.join(", ")}`);
  if (review.trademark_risk !== "low") reasons.push(`publication review found ${review.trademark_risk} trademark risk`);
  if (!review.title_is_generic) reasons.push("recipe title may identify a brand, publisher, or distinctive source title");
  if (review.implied_affiliation) reasons.push("recipe presentation may imply affiliation or endorsement");
  if (similarity.prose_trigram_jaccard_percent >= 50) reasons.push(`source/final prose trigram overlap is ${similarity.prose_trigram_jaccard_percent}%`);
  if (similarity.max_step_trigram_jaccard_percent >= 70) reasons.push(`a final instruction overlaps a source instruction by ${similarity.max_step_trigram_jaccard_percent}%`);
  if (brandMatches.length) reasons.push(`configured brand terms require review: ${brandMatches.map((item) => item.term).join(", ")}`);
  return [...new Set(reasons)];
}

function dateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

export function publicationRightsIssues(candidate, policy, catalogRecipes = [], runSourceCounts = new Map(), now = new Date()) {
  const reasons = [];
  const hostname = normalizeHostname(candidate?.source?.url);
  if (!hostname) return ["candidate source URL has no valid hostname"];
  const entry = policy?.sources?.[hostname];
  if (!entry) return [`no publication-rights record exists for ${hostname}`];
  if (entry.status !== "approved") reasons.push(`${hostname} is marked draft-only`);
  if (entry.basis === "unverified") reasons.push(`${hostname} has no verified publication-rights basis`);
  if (!entry.evidence.trim()) reasons.push(`${hostname} has no publication-rights evidence reference`);

  const reviewedAt = dateOnly(entry.reviewed_at);
  if (!reviewedAt) {
    reasons.push(`${hostname} has no valid rights review date`);
  } else {
    const ageDays = Math.floor((now.valueOf() - reviewedAt.valueOf()) / 86_400_000);
    if (ageDays > policy.review_after_days) reasons.push(`${hostname} rights review is ${ageDays} days old`);
  }
  const expiresAt = entry.expires_at ? dateOnly(entry.expires_at) : null;
  if (entry.expires_at && !expiresAt) reasons.push(`${hostname} has an invalid rights expiry date`);
  if (expiresAt && expiresAt.valueOf() < now.valueOf()) reasons.push(`${hostname} publication rights expired on ${entry.expires_at}`);

  const sourceCount = catalogRecipes.filter((recipe) => normalizeHostname(recipe.source?.url) === hostname).length;
  const runCount = runSourceCounts.get(hostname) ?? 0;
  if (entry.max_per_run > 0 && runCount + 1 > entry.max_per_run) reasons.push(`${hostname} exceeds its ${entry.max_per_run}-recipe per-run cap`);
  if (entry.max_catalog_recipes > 0 && sourceCount + 1 > entry.max_catalog_recipes) reasons.push(`${hostname} exceeds its ${entry.max_catalog_recipes}-recipe catalog cap`);

  const projectedCatalogSize = catalogRecipes.length + 1;
  if (projectedCatalogSize >= policy.collection.minimum_catalog_size_for_share_gate) {
    const projectedShare = ((sourceCount + 1) / projectedCatalogSize) * 100;
    if (projectedShare > policy.collection.max_source_share_percent) {
      reasons.push(`${hostname} would represent ${projectedShare.toFixed(1)}% of the catalog, above the ${policy.collection.max_source_share_percent}% collection cap`);
    }
  }
  return [...new Set(reasons)];
}
