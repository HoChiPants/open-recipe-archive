# Migrating selected recipes from Meals

The private `Meals` repository contains a large third-party recipe archive. This workflow prepares the entire archive as a private review bundle, but never commits or publishes it automatically. The repository content policy does not permit wholesale publication of third-party expressive text or a proprietary collection.

1. Obtain `shared/cleaned_recipes.json` (or the compatible `shared/recipes.json`) from the private repository.
2. Generate a private, ignored review bundle containing every source record. Seasonality defaults to the Northern Hemisphere:

   ```bash
   npm run meals:import -- --input /path/to/Meals/shared/cleaned_recipes.json --all --hemisphere northern
   ```

   The importer validates every generated record before writing it. It also:

   - reuses existing canonical ingredients by ID, name, or alias;
   - creates deterministic recipe IDs even when titles repeat;
   - parses hour-and-minute durations and makes numeric quantities scalable;
   - maps source tags into recipe tags, dietary flags, and allergens;
   - infers meal type, cuisine, equipment, ingredient category, and Northern Hemisphere seasonality;
   - derives recipe seasons from prominent fresh ingredients and dish style;
   - records missing, malformed, inferred, and outlier data in `work/meals-import/audit.json`.

   Re-running over an existing importer bundle requires `--clean`. Output is restricted to a dedicated directory below this project's ignored `work/` tree, and the command refuses to clean a directory without the importer's exact bundle marker. Use `--as-of <ISO date>` when byte-for-byte repeatable manifest timestamps are useful.
3. Review `work/meals-import/audit.json`, then every file under `work/meals-import`. Ingredient aliases, category, seasonality, inferred recipe metadata, and likely duplicate naming still need human judgment. Merge equivalent ingredient candidates with existing IDs where appropriate.
4. The source archive has no structured yield, so the importer assumes two servings unless a subtitle or tag states an exact serving count. A serving range uses its upper bound and remains audited as an estimate. Missing prep and total times are explicitly estimated and listed in the audit.
5. Replace every `REWRITE REQUIRED` step with your own concise directions, verify yield/times/nutrition/allergens, and remove the `needs-review` tag. The importer preserves the number of source steps but does not copy source prose or images.
6. Promote the reviewed bundle only if you have the right to dedicate it under CC0:

   ```bash
   npm run meals:promote -- --bundle work/meals-import --attest-rights
   npm run data:validate
   ```

7. Promote reviewed recipes in manageable batches and inspect each resulting diff before opening a focused pull request.

The manual GitHub Action produces the complete review bundle as a downloadable artifact. Because `Meals` is private, configure a repository secret named `MEALS_REPO_TOKEN` with read access to that repository. The action does not promote, commit, or push content.
