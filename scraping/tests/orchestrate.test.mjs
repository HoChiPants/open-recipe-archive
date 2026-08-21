import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, parseScrapeStatus, runPool, selectSites } from "../src/orchestrate.mjs";

test("parseArgs applies defaults and parses orchestration options", () => {
  assert.deepEqual(parseArgs([]), {
    limit: 25,
    concurrency: 3,
    sites: null,
    exclude: [],
    dryRun: false,
    overwrite: false,
    list: false,
    help: false
  });

  assert.deepEqual(
    parseArgs([
      "--sites=tastesbetterfromscratch,cookpad",
      "--exclude", "cookpad",
      "--limit", "250",
      "--concurrency=2",
      "--dry-run",
      "--overwrite"
    ]),
    {
      limit: 250,
      concurrency: 2,
      sites: ["tastesbetterfromscratch", "cookpad"],
      exclude: ["cookpad"],
      dryRun: true,
      overwrite: true,
      list: false,
      help: false
    }
  );
});

test("parseArgs rejects invalid values and unknown options", () => {
  assert.throws(() => parseArgs(["--limit", "0"]), /--limit must be an integer/);
  assert.throws(() => parseArgs(["--concurrency", "9"]), /--concurrency must be an integer/);
  assert.throws(() => parseArgs(["--sites="]), /--sites must contain/);
  assert.throws(() => parseArgs(["--wat"]), /Unknown option/);
});

test("selectSites includes, excludes, and validates site IDs", () => {
  const configured = ["allrecipes", "tastesbetterfromscratch", "cookpad"];
  assert.deepEqual(
    selectSites(configured, { sites: null, exclude: ["allrecipes"] }),
    ["tastesbetterfromscratch", "cookpad"]
  );
  assert.deepEqual(
    selectSites(configured, { sites: ["cookpad"], exclude: [] }),
    ["cookpad"]
  );
  assert.throws(
    () => selectSites(configured, { sites: ["unknown"], exclude: [] }),
    /Unknown site ID\(s\): unknown/
  );
});

test("runPool limits concurrency and preserves result order", async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await runPool([1, 2, 3, 4, 5], 2, async (item) => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    return item * 2;
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test("parseScrapeStatus reads child completion markers", () => {
  assert.deepEqual(
    parseScrapeStatus('SCRAPE_STATUS {"state":"exhausted","newCandidates":0}'),
    { state: "exhausted", newCandidates: 0 }
  );
  assert.equal(parseScrapeStatus("Saved 0 new candidate(s)."), null);
  assert.equal(parseScrapeStatus("SCRAPE_STATUS not-json"), null);
});
