import { relative } from "./library.mjs";
import { recipesStagingRoot, validateRecipesStaging } from "./recipes-staging-lib.mjs";

const result = await validateRecipesStaging();
if (result.absent) {
  console.log("Valid: recipes-staging is not present.");
} else if (result.errors.length) {
  console.error(`Recipe staging validation failed with ${result.errors.length} issue${result.errors.length === 1 ? "" : "s"}:`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
} else {
  console.log(`Valid: ${result.recipes.length} rights-pending recipes and ${result.ingredients.length} staged ingredients in ${relative(recipesStagingRoot)}.`);
}
