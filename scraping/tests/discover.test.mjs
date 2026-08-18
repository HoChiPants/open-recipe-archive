import assert from "node:assert/strict";
import test from "node:test";
import { configured, configuredSeeds, followable, urlsFromDocument } from "../src/core/discover.mjs";

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
