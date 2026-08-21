import assert from "node:assert/strict";
import test from "node:test";
import { configured, configuredSeeds, discover, followable, urlsFromDocument } from "../src/core/discover.mjs";

const site = {
  baseUrl: "https://cookpad.example",
  allow: ["/eng/recipes/"],
  follow: ["/eng/search/all?page="],
  block: ["/me/"]
};

test("extracts multiline sitemap locations and relative HTML links", () => {
  const text = `<loc>\nhttps://cookpad.example/eng/recipes/1\n</loc><a href=/eng/search/all?page=2>Next</a>`;
  assert.deepEqual(urlsFromDocument(text, site.baseUrl), [
    "https://cookpad.example/eng/recipes/1",
    "https://cookpad.example/eng/search/all?page=2"
  ]);
});

test("separates recipe candidates from pagination links", () => {
  assert.equal(configured("https://cookpad.example/eng/recipes/1", site), true);
  assert.equal(configured("https://cookpad.example/eng/search/all?page=2", site), false);
  assert.equal(followable("https://cookpad.example/eng/search/all?page=2", site), true);
  assert.equal(followable("https://cookpad.example/us/me/recipes/1", site), false);
});

test("expands bounded pagination templates", () => {
  assert.deepEqual(configuredSeeds({
    seeds: ["https://cookpad.example/eng/search/all"],
    pagination: { template: "https://cookpad.example/eng/search/all?page={page}", start: 2, end: 4 }
  }), [
    "https://cookpad.example/eng/search/all",
    "https://cookpad.example/eng/search/all?page=2",
    "https://cookpad.example/eng/search/all?page=3",
    "https://cookpad.example/eng/search/all?page=4"
  ]);
});

test("continues through pagination until it finds the requested number of new recipes", async () => {
  const pages = new Map([
    ["https://cookpad.example/eng/search/all", '<a href="/eng/recipes/1">Known</a><a href="/eng/search/all?page=2">Next</a>'],
    ["https://cookpad.example/eng/search/all?page=2", '<a href="/eng/recipes/2">New</a><a href="/eng/search/all?page=3">Next</a>'],
    ["https://cookpad.example/eng/search/all?page=3", '<a href="/eng/recipes/3">New</a>']
  ]);
  let stats;
  const result = await discover({
    ...site,
    seeds: ["https://cookpad.example/eng/search/all"],
    maxPages: 2
  }, { group: null, rules: [] }, {
    acceptRecipe: (url) => !url.endsWith("/1"),
    fetchPage: async (url) => ({ text: pages.get(url), contentType: "text/html" }),
    wait: async () => {},
    onComplete: (value) => { stats = value; }
  });

  assert.deepEqual(result, [
    "https://cookpad.example/eng/recipes/2",
    "https://cookpad.example/eng/recipes/3"
  ]);
  assert.equal(stats.skippedRecipes, 1);
  assert.equal(stats.reachedLimit, true);
});

test("follows child sitemaps and reports when all sitemap entries are exhausted", async () => {
  const pages = new Map([
    ["https://recipes.example/sitemap.xml", "<sitemapindex><loc>https://recipes.example/post-sitemap.xml</loc></sitemapindex>"],
    ["https://recipes.example/post-sitemap.xml", "<urlset><loc>https://recipes.example/recipe/one</loc><loc>https://recipes.example/recipe/two</loc></urlset>"]
  ]);
  let stats;
  const result = await discover({
    baseUrl: "https://recipes.example",
    seeds: ["https://recipes.example/sitemap.xml"],
    allow: ["/recipe/"],
    maxPages: 10
  }, { group: null }, {
    fetchPage: async (url) => ({ text: pages.get(url), contentType: "application/xml" }),
    wait: async () => {},
    onComplete: (value) => { stats = value; }
  });

  assert.deepEqual(result, [
    "https://recipes.example/recipe/one",
    "https://recipes.example/recipe/two"
  ]);
  assert.equal(stats.sourceQueueExhausted, true);
  assert.equal(stats.failedPages, 0);
});
