# Recipe scraping pipeline

This directory discovers recipe pages and extracts structured recipe candidates. It does **not** publish directly into `recipes/`: candidates land in `scraping/output/` for review and original rewriting under the repository's content policy.

## Quick start

1. Copy `config/sites.example.json` to `config/sites.json`.
2. Add only sites you have permission to crawl.
3. Preview discovery without downloading recipe pages:

   ```bash
   npm run scrape:discover -- --site example
   ```

4. Crawl a configured site:

   ```bash
   npm run scrape -- --site example --limit 25
   ```

5. Run the automatic three-stage pipeline. The first model call reduces source material to terse culinary facts; the second sees only those facts, preserves the ingredient objects, and rewrites the expressive recipe fields; the third independently compares the result with the source for expression, structure, likely brands, and implied affiliation. Deterministic overlap and brand checks run alongside that review. By default it writes drafts and analytics below the ignored `work/recipe-pipeline/` directory without changing the catalog:

   ```bash
   npm run candidate:auto -- --site allrecipes --limit 5
   ```

   The default provider is the authenticated Codex CLI. To use the Responses API instead, supply `OPENAI_API_KEY` in the environment and select the provider. Do not put the key in the repository:

   ```bash
   npm run candidate:auto -- --site allrecipes --limit 5 --provider api --model gpt-5.6-luna
   ```

   Publication is also gated by `config/publication-rights.json`. A missing or `draft-only` domain can still produce review drafts but cannot publish. Record an approval once per domain only when you actually have the stated license, ownership, public-domain basis, or written permission:

   ```bash
   npm run candidate:rights -- --list
   npm run candidate:rights -- \
     --source recipes.example.com \
     --approve \
     --basis written-permission \
     --evidence "permission agreement dated 2026-08-18" \
     --max-per-run 10 \
     --max-catalog-recipes 100
   ```

   Valid bases are `first-party`, `public-domain`, `cc0`, `compatible-license`, and `written-permission`. `--evidence` is a reference to the record you rely on; the command does not obtain or verify permission. Use `--draft-only` instead of `--approve` to revoke automated publication for a domain.

   The promotion command treats `--attest-publication-rights` as the operator's explicit authorization to publish the transformed factual recipe records. Missing or stale per-domain records remain visible as audit warnings but do not block that attested run. The flag does not obtain permission or create rights that the operator does not already have:

   ```bash
   npm run candidate:auto -- \
     --site allrecipes \
     --limit 5 \
     --promote \
     --attest-publication-rights
   ```

   Use `--candidate scraping/output/<site>/<file>.json` for one record, `--minimum-confidence 90` or `--minimum-review-confidence 90` for stricter gates, `--max-author-attempts 4` for more rewrite attempts, `--rights-policy <file>` for a separate audit policy, or `--keep-candidate` to retain promoted review files. Promotion defaults to three author/reviewer attempts. Each run records content and publication rejection reasons, source/final word counts, deterministic n-gram overlap, source-only word frequency, likely brand terms, the independent publication review, latency, editorial changes, and API usage when available in `analytics.json`.

   Automatic promotion holds unresolved food-safety endpoints, home preservation methods, low-confidence results, invalid schemas, unchanged titles, distinctive prose overlap, likely brand terms, and implied affiliation. Raw animal proteins can pass only when the rewritten directions contain the applicable safe endpoint. Allergen and dietary metadata are reconciled from the preserved ingredients. Missing rights evidence, per-source limits, and source concentration remain audit warnings during an explicitly attested promotion run.

   To process the entire queue across every site, first inspect the plan and then start the resumable run:

   ```bash
   npm run candidate:auto:all -- --plan
   npm run candidate:auto:all
   ```

   The all-sites Codex queue defaults to `gpt-5.3-codex-spark`; pass `--model <id>` to override it. Ingredients are copied from the extracted factual record rather than rewritten by the author model. Expressive fields are rewritten and screened, with automatic retries for similarity, confidence, brand, and resolvable safety failures. The queue writes `work/recipe-pipeline/all-sites-draft-checkpoint.json` after every candidate. Re-running the command skips completed entries and retries failures. Use `--retry-held` to reconsider content holds after changing the checks. Use `--restart` only when you intentionally want to regenerate the whole queue. For automatic publication, add `--promote --attest-publication-rights`.

6. The older manual command remains available for a hand-edited recipe. It requires the original source URL, marks the result as adapted, rejects review placeholders, and catches long passages retained from the source:

   ```bash
   npm run candidate:promote -- \
     --candidate scraping/output/example/review.json \
     --recipe work/edited-recipe.json \
     --attest-original-wording \
     --remove-candidate
   ```

   Similarity, editorial-change, trademark, and word-count analytics are screening controls, not legal clearance tests. Trademark clearance is broader than checking an exact name, and attribution and automated rewriting do not create publication rights.

Use `npm run scrape -- --url https://example.com/a-recipe` to extract one authorized page without configuring discovery. For convenience, a full URL passed to `--site` is also recognized as a direct URL. Use `--dry-run` to list URLs without fetching their pages.

## Configured sites

Every configured site uses the same preview and crawl commands:

```bash
npm run scrape:discover -- --site cookpad --limit 250
npm run scrape -- --site cookpad --limit 250
```

Replace `cookpad` with any configured English-language source ID:

| Site ID | Publisher |
| --- | --- |
| `allrecipes` | Allrecipes |
| `tastesbetterfromscratch` | Tastes Better From Scratch |
| `cookpad` | Cookpad English |
| `recipetineats` | RecipeTin Eats |
| `bbcgoodfood` | BBC Good Food |
| `loveandlemons` | Love and Lemons |
| `sallysbakingaddiction` | Sally's Baking Addiction |

Serious Eats, The Kitchn, and Chefkoch are not configured because their recipe pages currently reject this crawler with anti-bot responses. Do not work around those controls; add them only if the sites provide an authorized feed, API, or crawler access.

## Run multiple sites

Run every configured site with up to three isolated scraper processes at a time:

```bash
npm run scrape:sites -- --limit 250 --concurrency 3
```

Run only a subset, or preview discovery without downloading recipe pages:

```bash
npm run scrape:sites -- --sites tastesbetterfromscratch,cookpad,recipetineats --limit 250 --concurrency 2
npm run scrape:sites -- --dry-run --limit 250
```

Use `--exclude allrecipes,cookpad` to omit sites, or `--list` to print all configured IDs. Logs are prefixed with each site ID and failures are summarized after the other jobs finish. Each site still uses its own robots rules, request delay, output folder, and URL ledger.

Discovery walks every configured sitemap (including child sitemaps) or numbered/followed result page until it either finds the requested number of genuinely new URLs or exhausts the source. The final summary reports:

- `OK` when a full batch was found and more URLs may remain.
- `DONE` when the final partial batch was found, or no new recipe URLs remain.
- `WARN` when too few URLs were found but failed or robots-blocked discovery pages mean exhaustion could not be confirmed.

Run the same command again after `OK` to collect the next batch. A `DONE` site can still gain recipes later if its publisher adds new entries to its sitemap or result pages.

## Layout

```text
config/       per-site seeds, allow/block patterns, and crawl limits
src/adapters/ extraction adapters (JSON-LD first; add site-specific adapters here)
src/core/     discovery, robots.txt, fetching, normalization, and storage
output/       ignored review queue created by the crawler
state/        ignored per-site URL ledgers used to prevent repeat downloads
tests/        offline fixtures and extraction tests
```

## Safety defaults

- `robots.txt` is checked before every fetch. A missing robots file is not treated as permission; configure only authorized sites.
- Requests are sequential, identify this project, and wait at least the configured delay.
- Crawling stays on the configured host and obeys allow/block URL patterns.
- Existing output is not overwritten unless `--overwrite` is passed.
- Checked URLs are recorded in `state/<site>.jsonl` and skipped on future runs, including fetched pages that contain no structured Recipe data. Existing candidate files are added to the ledger automatically.
- Page HTML and images are not archived.
- Candidates include provenance and a review warning; they are not part of the public catalog.

This is an ingestion tool, not a license grant. Site terms, database rights, privacy rules, and copyright law may apply.
