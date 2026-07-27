import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalUrl, loadLedger, recordScraped } from "../src/core/ledger.mjs";

test("recovers existing candidates and records new URLs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-ledger-"));
  try {
    const output = path.join(root, "scraping/output/example");
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "old.json"), JSON.stringify({ source: { url: "https://example.com/recipe/1/?utm_source=test", retrieved_at: "2026-01-01T00:00:00Z" } }));

    const first = await loadLedger(root, "example");
    assert.equal(first.recovered, 1);
    assert(first.urls.has("https://example.com/recipe/1/"));

    await recordScraped(root, "example", "https://example.com/recipe/2/#method", ["scraping/output/example/new.json"]);
    const second = await loadLedger(root, "example");
    assert.equal(second.urls.size, 2);
    assert.equal(canonicalUrl("https://example.com/recipe/2/#top"), "https://example.com/recipe/2/");
    assert.match(await readFile(second.file, "utf8"), /recipe\/2/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
