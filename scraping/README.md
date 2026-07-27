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

5. Inspect the JSON candidates in `scraping/output/<site>/`. Rewrite expressive directions in your own concise words, confirm all facts, then move a schema-valid record into the appropriate `recipes/<meal-type>/` folder.

Use `npm run scrape -- --url https://example.com/a-recipe` to extract one authorized page without configuring discovery. For convenience, a full URL passed to `--site` is also recognized as a direct URL. Use `--dry-run` to list URLs without fetching their pages.

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
- Successfully extracted URLs are recorded in `state/<site>.jsonl` and skipped on future runs. Existing candidate files are added to the ledger automatically.
- Page HTML and images are not archived.
- Candidates include provenance and a review warning; they are not part of the public catalog.

This is an ingestion tool, not a license grant. Site terms, database rights, privacy rules, and copyright law may apply.
