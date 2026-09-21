import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    const location = path.join(directory, entry.name);
    return entry.isDirectory() ? files(location) : entry.name.endsWith('.json') ? [location] : [];
  }));
  return groups.flat();
}

// Adapt finalized records to the same candidate contract as scraper output.
// Exporting does not change their editorial status or publish the archive site.
export function recipeToCandidate(recipe) {
  const nutritionKeys = { calories: 'calories', protein_g: 'proteinContent', carbohydrates_g: 'carbohydrateContent', fat_g: 'fatContent', fiber_g: 'fiberContent', sugar_g: 'sugarContent', sodium_mg: 'sodiumContent' };
  const nutrition = Object.fromEntries(Object.entries(nutritionKeys).flatMap(([key, target]) => {
    const value = recipe.nutrition?.[key];
    return value == null ? [] : [[target, `${value} ${key === 'calories' ? 'kcal' : key.endsWith('_mg') ? 'mg' : 'g'}`]];
  }));
  return {
    candidate_version: '1.0.0',
    review_status: 'archive-recipe',
    source: {
      name: recipe.source?.name || 'Open Recipe Archive',
      url: recipe.source?.url || `https://github.com/HoChiPants/open-recipe-archive/blob/main/recipes/${recipe.meal_type}/${recipe.id}.json`,
    },
    extracted: {
      id: recipe.id, name: recipe.name, description: recipe.description,
      yield: recipe.yield, times: recipe.times, nutrition,
      ingredient_lines: recipe.ingredients.map(ingredient => [ingredient.quantity, ingredient.unit, ingredient.item, ingredient.preparation ? `(${ingredient.preparation})` : ''].filter(value => value !== undefined && value !== null && value !== '').join(' ')),
      instruction_lines: [...recipe.instructions].sort((a, b) => a.step - b.step).map(step => step.text),
      categories: [...new Set([recipe.meal_type, recipe.cuisine, ...(recipe.tags || [])].filter(Boolean))],
    },
  };
}

export async function exportMealManager(output, archiveRoot = root) {
  const recipes = [];
  const rejected = [];
  // Prefer curated data where its source URL overlaps a scraped candidate.
  for (const collection of ['recipes', 'scraping/output']) {
    const inputFiles = await files(path.join(archiveRoot, collection));
    for (let offset = 0; offset < inputFiles.length; offset += 64) {
      const records = await Promise.all(inputFiles.slice(offset, offset + 64).map(async file => {
        try {
          const document = JSON.parse(await readFile(file, 'utf8'));
          const candidate = collection === 'recipes' ? recipeToCandidate(document) : document;
          return { recipe: { ...candidate, archive_file: path.relative(archiveRoot, file) } };
        } catch (error) {
          return { error: { path: path.relative(archiveRoot, file), reason: error.message } };
        }
      }));
      for (const record of records) {
        if (record.error) rejected.push(record.error);
        else recipes.push(record.recipe);
      }
    }
  }
  const bundle = { schema_version: '1.0.0', provider: 'recipes-api', recipes, rejected };
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify(bundle) + '\n');
  console.log(`Exported ${recipes.length} records; ${rejected.length} unreadable records. Bundle: ${output}`);
  return bundle;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args[0]?.startsWith('--')) throw new Error('Usage: npm run meal-manager:export -- [output.json]');
  await exportMealManager(args[0] || path.join(root, 'work/meal-manager/recipes.json'));
}
