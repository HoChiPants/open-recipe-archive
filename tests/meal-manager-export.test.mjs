import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recipeToCandidate, exportMealManager } from '../scripts/export-meal-manager.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('finalized recipes export without promotion and preserve amounts and preparation', () => {
  const result = recipeToCandidate({id:'oats',name:'Oats',meal_type:'breakfast',ingredients:[{item:'oats',quantity:'1/2',unit:'cup',preparation:'toasted'}], instructions:[{step:2,text:'Serve.'},{step:1,text:'Mix.'}],nutrition:{protein_g:10},tags:['quick']});
  assert.deepEqual(result.extracted.ingredient_lines,['1/2 cup oats (toasted)']);
  assert.deepEqual(result.extracted.instruction_lines,['Mix.','Serve.']);
  assert.equal(result.extracted.nutrition.proteinContent,'10 g');
  assert.equal(result.review_status,'archive-recipe');
  assert.match(result.source.url,/recipes\/breakfast\/oats.json$/);
});

test('raw unreviewed candidates export directly and malformed files do not stop the batch', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'recipe-export-test-'));
  try {
    await mkdir(path.join(root, 'recipes'));
    await mkdir(path.join(root, 'scraping/output'), {recursive:true});
    const raw = {review_status:'needs-review',source:{url:'https://example.com/recipe'},extracted:{name:'Test'}};
    await writeFile(path.join(root, 'scraping/output/a.json'), JSON.stringify(raw));
    await writeFile(path.join(root, 'scraping/output/b.json'), '{broken');
    const result = await exportMealManager(path.join(root,'bundle.json'),root);
    assert.equal(result.recipes.length,1);
    assert.equal(result.recipes[0].review_status,'needs-review');
    assert.equal(result.recipes[0].archive_file,'scraping/output/a.json');
    assert.equal(result.rejected[0].path,'scraping/output/b.json');
  } finally { await rm(root,{recursive:true,force:true}); }
});
