# Open Recipe Archive

A portable recipe library where every recipe and ingredient is plain JSON. Clone it, search it in the included browser app, use the generated catalog in another project, or contribute a recipe without depending on a hosted database.

The repository starts small on purpose: the data model and contribution tools are designed to support a much larger community collection.

## Start the library

You need Node.js 22 or newer.

```bash
npm install
npm start
```

Open the local address shown in the terminal. The app can:

- search by title, tag, cuisine, or ingredient;
- filter by meal type, dietary flag, and season;
- scale ingredient quantities for a different number of servings;
- build a weekly meal plan saved in the browser;
- download and restore a portable personal archive containing meal plans, preferences, cookbooks, and imported recipes;
- import a recipe JSON file for device-local browsing;
- download individual recipes or the complete generated catalog;
- browse the canonical ingredient reference.

Browser imports and meal plans stay on that device. To add a recipe to the shared library, add its JSON file to the repository and open a pull request.

### Personal data and self-hosting

The public recipe catalog and canonical ingredients belong in Git. Personal data does not: meal plans, preferences, cookbooks, notes, and imported recipes are stored together in the browser under the versioned contract in [`schemas/personal-data.schema.json`](schemas/personal-data.schema.json). Use **Download personal data** on the Meal plan page to create a backup, and **Import or restore** to load it on another device or self-hosted copy.

The personal archive uses recipe IDs, so it remains portable across deployments of this repository. Keep personal archives in a private repository or outside GitHub; do not commit them to a public fork. A future server storage adapter can persist this same document without changing the browser export format.

## Repository layout

```text
recipes/                 one recipe per file, grouped by meal type
ingredients/             canonical ingredient records and seasonality
schemas/                 JSON Schema contracts for recipes and ingredients
scripts/                 validation, catalog generation, and scaffolding tools
scraping/                authorized discovery and recipe-candidate extraction
public/data/catalog.json generated portable catalog used by other apps
app/                     the searchable local website
docs/                    schema and content guidance
```

## Add a recipe

Create a ready-to-edit file:

```bash
npm run recipe:new -- --name "Crispy roast potatoes" --type side
```

Then edit the new JSON file and check it:

```bash
npm run data:validate
```

The required recipe fields are:

- `schema_version`, `id`, and `name`
- `meal_type`
- `yield` and `times`
- `ingredients` and `instructions`
- `tags`

Useful optional fields include `subtitle`, `description`, `cuisine`, `nutrition`, `seasons`, `dietary`, `allergens`, `equipment`, `source`, and `notes`. See [the schema guide](docs/SCHEMA.md) and [the complete JSON Schema](schemas/recipe.schema.json).

## Commands

| Command                                                                                                   | Purpose                                                                               |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm start`                                                                                               | Validate the data, rebuild the catalog, and start the website                         |
| `npm run data:validate`                                                                                   | Check schemas, unique IDs, step order, and ingredient references                      |
| `npm run catalog:build`                                                                                   | Rebuild the TypeScript and public JSON catalogs                                       |
| `npm run dailydine:feed -- --release <id>`                                                                | Build and verify the normalized-only Daily Dine feed                                  |
| `npm run recipe:new -- --name "…" --type main`                                                            | Scaffold a recipe file                                                                |
| `npm run candidate:auto -- --site <id> --limit 5`                                                         | Preserve ingredient facts, rewrite expressive fields, and generate pipeline analytics |
| `npm run candidate:auto:all -- --plan`                                                                    | Plan the resumable all-sites queue (GPT-5.6 Luna by default)                          |
| `npm run candidate:batch -- --count 10 --attest-publication-rights`                                       | Normalize, review, promote, and build a feed for the next cross-site batch            |
| `npm run candidate:staged:promote -- --plan`                                                              | Revalidate staged rewrites without making model calls                                 |
| `npm run candidate:rights -- --list`                                                                      | Inspect reusable source publication-rights records                                    |
| `npm run candidate:promote -- --candidate <review.json> --recipe <edited.json> --attest-original-wording` | Validate and promote an independently rewritten candidate                             |
| `npm run scrape:discover -- --site <id>`                                                                  | Preview URLs from an authorized configured site                                       |
| `npm run scrape -- --site <id> --limit 25`                                                                | Extract recipe candidates into the review queue                                       |
| `npm run scrape:test`                                                                                     | Run offline scraper extraction tests                                                  |
| `npm run meals:import -- --input <file> --all`                                                            | Prepare the complete legacy archive for rights and editorial review                   |
| `npm run build`                                                                                           | Produce a deployment build                                                            |
| `npm test`                                                                                                | Validate data, build the app, and run rendering checks                                |

## Use the catalog elsewhere

After `npm run catalog:build`, `public/data/catalog.json` contains:

```json
{
  "schema_version": "1.0.0",
  "generated_at": "2026-07-14T00:00:00.000Z",
  "recipes": [],
  "ingredients": []
}
```

Consumers should depend on `schema_version`, not the generated timestamp or file order. Recipe and ingredient IDs are stable lookup keys.

## Daily Dine archive feed

The Daily Dine feed is a deterministic, paginated export of finalized recipes under `recipes/` that have passed normalization and source review. Raw scrape candidates in `scraping/output` are never feed inputs. A finalized record is eligible only when it has a canonical source URL and normalization provenance with `requires_review: false` and `source_review_status: passed`; missing, malformed, failed, or held transformations are omitted.

Each record has a stable `archive_id` formed as `<canonical-source-host>:<first-24-hex-of-canonical-source-URL-SHA-256>`. The canonical source URL is the sole identity input, so a normalized recipe updates the same Daily Dine row previously linked to that URL. The feed includes source and normalized text hashes, model/version, prompt version, transformation timestamp, and similarity scores. It contains no source image fields.

Scraping and publishing are deliberately separate. Plan and run the resumable Codex pipeline first (the all-sites and bounded batch commands request `gpt-5.6-luna` by default). Every completed candidate writes one stable record under `work/recipe-pipeline/staged/`; reruns update that same staged path. Later promotion revalidates the current source hash, normalized hash, schemas, similarity decision, and current rights policy without calling the model again:

```bash
npm run candidate:auto:all -- --plan
npm run candidate:auto:all -- --model gpt-5.6-luna --concurrency 4 --max-author-attempts 1
npm run candidate:staged:promote -- --plan
npm run candidate:staged:promote -- --attest-publication-rights
```

The pipeline extracts title, yield, times, categories, ingredient quantities, and terse operation facts deterministically from the structured scrape, so fact extraction spends no model usage. A clear candidate normally uses one Luna call to author independently worded expressive fields. Local schema, ingredient, food-safety, copied-phrase, trigram, title, and brand checks decide clear passes and holds; only borderline similarity is escalated to a separate model review. Unchanged staged results from the same pipeline/model/source hash are reused with zero model calls. The pipeline still uses strict structured JSON, three transport/output retries per model call by default, a 750 ms minimum delay, and atomic checkpoints. `--concurrency` controls parallel author/reviewer work and is capped at 8; model starts remain rate-limited, while checkpoint writes, rights accounting, staged promotion, and feed generation stay serialized. `--max-author-attempts 1` produces exactly one authored recipe; model-call retries only recover failed or malformed responses and do not create alternate recipes. Use `--model-retries` and `--model-delay-ms` to tune throughput. Planning and staging do not change finalized recipes. The attestation flag does not override the rights policy: an absent, stale, draft-only, expired, or unverified source record remains on publication hold.

For a bounded cross-site batch, use `candidate:batch`. It takes the next unprocessed candidates regardless of source directory, reuses unchanged stages, performs up to three author attempts only when a deterministic or borderline review fails, promotes only content-and-rights-approved records without another model call, and rebuilds the local verified feed:

```bash
npm run candidate:batch -- --count 500 --concurrency 4 --model gpt-5.6-luna --attest-publication-rights
```

The count is the number of candidates attempted, so the number promoted can be lower when records fail or remain held. This command never connects to Daily Dine or production; immutable release creation and the Daily Dine write workflow remain explicit deployment steps.

Build a release with a stable release ID and timestamp:

```bash
npm run dailydine:feed -- --release local-plan-check --as-of 2026-08-31T00:00:00.000Z
```

The command writes `build/dailydine-feed/manifest.json` and numbered JSON pages under `build/dailydine-feed/pages/`. The manifest records page hashes, record/page totals, and its own canonical `manifest_hash`; the command verifies all of them before reporting its one-line summary. Canonical source URLs must be unique, and canonical JSON key and record ordering use Unicode code-point order so the same bytes are produced across locales. See [`schemas/dailydine-feed.schema.json`](schemas/dailydine-feed.schema.json) for the wire contract. Generated feed files are intentionally ignored.

On `main`, changes to finalized recipes, the recipe/feed schemas, or feed scripts run the **Publish Daily Dine feed** workflow. New raw scrape output alone does not publish a feed. Enable GitHub immutable releases for this repository before using that automation. Each publish creates the commit-tagged release `dailydine-feed-<commit-sha>` with all assets in the same release-creation operation. An existing release is reused only when GitHub reports it as immutable; the workflow never replaces release assets.

- `manifest.json`, the verified page index and hash contract;
- `dailydine-feed.tar.gz`, the manifest and every numbered page.

The workflow can notify Daily Dine through GitHub's repository-dispatch API when the `DAILYDINE_DISPATCH_TOKEN` secret is configured. Create a fine-grained PAT limited to `HoChiPants/meal-manager` with repository permission **Contents: write** and no other permissions, then store it as `DAILYDINE_DISPATCH_TOKEN` in the archive repository. The secret is only available to the notification step and is not needed to publish the feed. If it is absent, publication still succeeds and Daily Dine's nightly reconciliation discovers the release.

Daily Dine must treat the release URLs as untrusted until it verifies the downloaded bundle: read `manifest.json`, confirm its canonical `manifest_hash`, verify each listed page hash and record/page total, and accept the release only when the manifest `release_id` matches the dispatched release ID. This detects incomplete, stale, or altered release assets before the archive is imported for review.

The complete private legacy Meals archive can be prepared with the guarded [migration workflow](docs/MEALS_MIGRATION.md). It creates review drafts only and does not bulk-publish or copy source instructions.

## Licensing and recipe sources

Code is available under the MIT License. Original repository data is dedicated to the public domain under CC0 1.0; contributors must have the right to make that dedication.

A recipe's ingredient list and underlying procedure may not be protected by U.S. copyright, but expressive descriptions, photographs, and creative instructional text can be. Do not copy a cookbook page or food blog verbatim. Use your own concise wording and record the source when adapting an idea. Read [the content policy](docs/CONTENT_POLICY.md) before contributing.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), keep each recipe in its own file, add canonical ingredients when useful, and run `npm test` before opening a pull request.
