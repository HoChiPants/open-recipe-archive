import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the recipe library", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Open Recipe Archive<\/title>/i);
  assert.match(html, /Strawberry overnight oats/);
  assert.match(html, /Import JSON/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("generated catalog contains recipes and ingredients", async () => {
  const catalog = JSON.parse(await readFile(new URL("../public/data/catalog.json", import.meta.url), "utf8"));
  assert.equal(catalog.schema_version, "1.0.0");
  assert.ok(catalog.recipes.length >= 7);
  assert.ok(catalog.ingredients.length >= 20);
  assert.ok(catalog.recipes.every((recipe) => recipe.id && recipe.ingredients.length && recipe.instructions.length));
});
