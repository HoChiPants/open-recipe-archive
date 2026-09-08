# Rights-pending recipe staging

This directory contains normalized, production-shaped recipe records for private review with source companies. **It is not an approved publication feed.** No file here represents a claim that Daily Dine has permission to publish the source recipe.

The recipes have passed the automated content-normalization checks, preserve source attribution and canonical URLs, and omit source images. They remain excluded from the public feed because the feed builder reads only `recipes/`.

Do not copy these files into `recipes/` or a production database manually. After written permission or another valid publication basis is recorded in `scraping/config/publication-rights.json`, use `npm run recipes-staging:promote -- --plan` and then rerun it with `--attest-publication-rights`. The gate checks the recorded source-specific evidence before promotion.
