# Migrating selected recipes from Meals

The private `Meals` repository contains a large third-party recipe archive. This workflow prepares the entire archive as a private review bundle, but never commits or publishes it automatically. The repository content policy does not permit wholesale publication of third-party expressive text or a proprietary collection.

1. Obtain `shared/recipes.json` from the private repository.
2. Generate a private, ignored review bundle containing every source record:

   ```bash
   npm run meals:import -- --input /path/to/Meals/shared/recipes.json --all
   ```

4. Review every file under `work/meals-import`. The importer creates canonical ingredient candidates, but category, seasonality, aliases, and duplicate naming still need human review. Merge equivalent ingredients with existing IDs.
5. Replace the `REWRITE REQUIRED` instruction with your own concise directions, verify yield/times/nutrition/allergens, and remove the `needs-review` tag. Do not copy source prose or images.
6. Promote the reviewed bundle only if you have the right to dedicate it under CC0:

   ```bash
   npm run meals:promote -- --bundle work/meals-import --attest-rights
   npm run data:validate
   ```

7. Promote reviewed recipes in manageable batches and inspect each resulting diff before opening a focused pull request.

The manual GitHub Action produces the complete review bundle as a downloadable artifact. Because `Meals` is private, configure a repository secret named `MEALS_REPO_TOKEN` with read access to that repository. The action does not promote, commit, or push content.
