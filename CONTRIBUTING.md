# Contributing

Thank you for helping build an open, portable recipe reference.

## Before you begin

- Read [the content policy](docs/CONTENT_POLICY.md).
- Search existing recipe and ingredient IDs to avoid duplicates.
- Use original, practical wording. Do not paste expressive text or images from another publication.
- Add source information when a recipe adapts an existing work or tradition.

## Recipe workflow

1. Run `npm run recipe:new -- --name "Recipe name" --type main`.
2. Fill in the generated JSON. Keep the stable ID in lowercase kebab case.
3. Every finalized recipe ingredient must reference a canonical `ingredient_id`. Run `npm run ingredients:backfill` to create missing catalog records before adding their IDs to recipes. The readable `item` field remains required so recipes are useful by themselves.
4. Put instructions in cooking order and number them from 1 without gaps.
5. Only include nutrition values when their source or estimation method is identified.
6. Run `npm test`.
7. Open a pull request describing what you added and how you tested it.

## Data conventions

- Use common singular ingredient names for canonical records: `egg`, not `eggs`.
- Use numeric quantities when exact; strings are allowed for familiar fractions such as `"1/3"`.
- Keep units readable and unabbreviated where practical.
- Use `year-round` only when seasonality is not meaningful or the ingredient is broadly available throughout the year.
- Put preparation after the ingredient amount, such as `"thinly sliced"`.
- Allergen flags are informational and must not be treated as a medical guarantee.

## Pull request scope

Keep data-only contributions focused. A pull request may include a recipe, its missing canonical ingredients, and regenerated catalog output. Avoid unrelated formatting or application changes.
