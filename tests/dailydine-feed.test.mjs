import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  archiveIdForCandidate,
  buildDailyDineFeed,
  canonicalSourceUrl,
  compareUnicodeCodePoints,
  contentHashForCandidate,
  verifyBuiltFeed,
} from "../scripts/dailydine-feed-lib.mjs";

const candidate = {
  candidate_version: "1.0.0",
  review_status: "needs-review-and-original-wording",
  source: {
    name: "Allrecipes",
    url: "https://www.allrecipes.com/recipe/test-recipe/",
    retrieved_at: "2026-08-30T12:00:00.000Z",
  },
  extracted: {
    id: "Test Recipe",
    name: "Test Recipe",
    description: "A concise recipe description.",
    yield: { quantity: 4, unit: "servings" },
    times: { prep_minutes: 10, cook_minutes: 20, inactive_minutes: 0 },
    ingredient_lines: ["1 cup flour", "1 cup water"],
    instruction_lines: ["Combine the ingredients.", "Cook until done."],
    categories: ["Dinner", "Test"],
    nutrition: { calories: "100 kcal" },
  },
};

function sourceUrlHash(candidateValue, length) {
  return createHash("sha256").update(canonicalSourceUrl(candidateValue.source.url)).digest("hex").slice(0, length);
}

async function withTemporaryDirectory(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dailydine-feed-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeCandidate(directory, name, value) {
  await mkdir(directory, { recursive: true });
  const candidatePath = path.join(directory, name);
  await writeFile(candidatePath, `${JSON.stringify(value, null, 2)}\n`);
  return candidatePath;
}

test("derives archive identity only from the canonical source URL", () => {
  assert.equal(
    archiveIdForCandidate(candidate),
    `allrecipes.com:${sourceUrlHash(candidate, 24)}`,
  );

  const renamedTitle = structuredClone(candidate);
  renamedTitle.extracted.name = "A Completely Different Title";
  assert.equal(archiveIdForCandidate(renamedTitle), archiveIdForCandidate(candidate));
  assert.notEqual(contentHashForCandidate(renamedTitle), contentHashForCandidate(candidate));

  const changedExtractedId = structuredClone(candidate);
  changedExtractedId.extracted.id = "A Completely Different Slug";
  assert.equal(archiveIdForCandidate(changedExtractedId), archiveIdForCandidate(candidate));

  const changedTimestamp = structuredClone(candidate);
  changedTimestamp.source.retrieved_at = "2026-08-31T12:00:00.000Z";
  assert.equal(
    contentHashForCandidate(candidate),
    contentHashForCandidate(changedTimestamp),
  );
});

test("keeps the extracted slug as metadata without making it identity", async () => {
  const missingId = structuredClone(candidate);
  delete missingId.extracted.id;

  assert.equal(
    archiveIdForCandidate(missingId),
    `allrecipes.com:${sourceUrlHash(missingId, 24)}`,
  );

  await withTemporaryDirectory(async (directory) => {
    const inputDir = path.join(directory, "input");
    const outputDir = path.join(directory, "output");
    await writeCandidate(inputDir, "candidate.json", candidate);
    await buildDailyDineFeed({
      inputDir,
      outputDir,
      releaseId: "test-release",
      generatedAt: "2026-08-31T00:00:00.000Z",
      pageSize: 250,
    });
    const page = JSON.parse(await readFile(path.join(outputDir, "pages", "page-00001.json"), "utf8"));
    assert.equal(page.recipes[0].slug, "test-recipe");
    assert.equal(page.recipes[0].source.url, "https://allrecipes.com/recipe/test-recipe/");
  });
});

test("matches the fixed producer-consumer semantic content-hash vector", () => {
  assert.equal(
    contentHashForCandidate(candidate),
    "4114b44b8f19573f9ed8a54d84cc946206dd554a7e3fc607aff887e6be95e0d6",
  );
});

test("orders strings by Unicode code point rather than locale", () => {
  assert.deepEqual(
    ["\uE000", "\u{10000}", "A"].sort(compareUnicodeCodePoints),
    ["A", "\uE000", "\u{10000}"],
  );
});

test("builds a deterministic, verifiable feed in archive-ID order", async () => {
  await withTemporaryDirectory(async (directory) => {
    const inputDir = path.join(directory, "input");
    const firstOutputDir = path.join(directory, "first");
    const secondOutputDir = path.join(directory, "second");
    await writeCandidate(inputDir, "zebra.json", candidate);
    await writeCandidate(inputDir, "alpha.json", {
      ...candidate,
      source: { ...candidate.source, url: "https://example.test/recipe/alpha" },
      extracted: { ...candidate.extracted, id: "Alpha Recipe", name: "Alpha Recipe" },
    });

    const options = {
      inputDir,
      releaseId: "test-release",
      generatedAt: "2026-08-31T00:00:00.000Z",
      pageSize: 250,
    };
    const first = await buildDailyDineFeed({ ...options, outputDir: firstOutputDir });
    const second = await buildDailyDineFeed({ ...options, outputDir: secondOutputDir });

    assert.deepEqual(first, second);
    assert.equal(first.total_records, 2);
    assert.equal(first.total_pages, 1);
    assert.deepEqual(first.pages.map((page) => page.archive_id_start), [archiveIdForCandidate(candidate)]);
    assert.deepEqual(first.pages.map((page) => page.archive_id_end), [
      `example.test:${sourceUrlHash({ ...candidate, source: { ...candidate.source, url: "https://example.test/recipe/alpha" } }, 24)}`,
    ]);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(firstOutputDir, "pages", "page-00001.json"), "utf8")).recipes.map((recipe) => recipe.archive_id),
      [
        archiveIdForCandidate(candidate),
        `example.test:${sourceUrlHash({ ...candidate, source: { ...candidate.source, url: "https://example.test/recipe/alpha" } }, 24)}`,
      ],
    );
    await assert.doesNotReject(() => verifyBuiltFeed({
      manifestPath: path.join(firstOutputDir, "manifest.json"),
      pagesDir: path.join(firstOutputDir, "pages"),
    }));
  });
});

test("keeps distinct same-host source URLs with the same extracted ID", async () => {
  await withTemporaryDirectory(async (directory) => {
    const inputDir = path.join(directory, "input");
    const secondCandidate = {
      ...candidate,
      source: { ...candidate.source, url: "https://www.allrecipes.com/recipe/test-recipe-variant/" },
    };
    await writeCandidate(inputDir, "first.json", candidate);
    await writeCandidate(inputDir, "second.json", secondCandidate);

    const manifest = await buildDailyDineFeed({
      inputDir,
      outputDir: path.join(directory, "output"),
      releaseId: "test-release",
      generatedAt: "2026-08-31T00:00:00.000Z",
      pageSize: 250,
    });
    const page = JSON.parse(await readFile(path.join(directory, "output", "pages", "page-00001.json"), "utf8"));
    assert.equal(manifest.total_records, 2);
    assert.notEqual(page.recipes[0].archive_id, page.recipes[1].archive_id);
  });
});

test("rejects duplicate canonical source URLs before writing a feed", async () => {
  await withTemporaryDirectory(async (directory) => {
    const inputDir = path.join(directory, "input");
    await writeCandidate(inputDir, "first.json", candidate);
    await writeCandidate(inputDir, "second.json", {
      ...candidate,
      source: {
        ...candidate.source,
        url: "https://ALLRECIPES.com:443/recipe/../recipe/test-recipe/#print",
      },
      extracted: {
        ...candidate.extracted,
        id: "Renamed recipe",
        name: "Renamed recipe",
      },
    });

    await assert.rejects(
      () => buildDailyDineFeed({
        inputDir,
        outputDir: path.join(directory, "output"),
        releaseId: "test-release",
        generatedAt: "2026-08-31T00:00:00.000Z",
        pageSize: 250,
      }),
      /duplicate canonical source URL/i,
    );
  });
});

test("keeps a valid existing feed when a replacement build is invalid", async () => {
  await withTemporaryDirectory(async (directory) => {
    const inputDir = path.join(directory, "input");
    const outputDir = path.join(directory, "output");
    const options = {
      inputDir,
      outputDir,
      releaseId: "test-release",
      generatedAt: "2026-08-31T00:00:00.000Z",
      pageSize: 250,
    };
    await writeCandidate(inputDir, "candidate.json", candidate);
    const firstManifest = await buildDailyDineFeed(options);

    await writeCandidate(inputDir, "candidate.json", {
      ...candidate,
      extracted: { ...candidate.extracted, yield: { quantity: 0, unit: "servings" } },
    });
    await assert.rejects(() => buildDailyDineFeed(options), /schema validation failed/i);
    assert.deepEqual(
      await verifyBuiltFeed({ manifestPath: path.join(outputDir, "manifest.json"), pagesDir: path.join(outputDir, "pages") }),
      firstManifest,
    );
  });
});

test("loads a large candidate directory without exhausting file descriptors", async () => {
  await withTemporaryDirectory(async (directory) => {
    const inputDir = path.join(directory, "input");
    for (let index = 0; index < 512; index += 1) {
      await writeCandidate(inputDir, `candidate-${index}.json`, {
        ...candidate,
        source: { ...candidate.source, url: `https://example.test/recipe/${index}` },
        extracted: { ...candidate.extracted, id: `Recipe ${index}`, name: `Recipe ${index}` },
      });
    }
    const manifest = await buildDailyDineFeed({
      inputDir,
      outputDir: path.join(directory, "output"),
      releaseId: "test-release",
      generatedAt: "2026-08-31T00:00:00.000Z",
      pageSize: 250,
    });
    assert.equal(manifest.total_records, 512);
    assert.equal(manifest.total_pages, 3);
  });
});

test("rejects a page whose bytes no longer match its declared hash", async () => {
  await withTemporaryDirectory(async (directory) => {
    const inputDir = path.join(directory, "input");
    const outputDir = path.join(directory, "output");
    await writeCandidate(inputDir, "candidate.json", candidate);
    await buildDailyDineFeed({
      inputDir,
      outputDir,
      releaseId: "test-release",
      generatedAt: "2026-08-31T00:00:00.000Z",
      pageSize: 250,
    });
    const pagePath = path.join(outputDir, "pages", "page-00001.json");
    await writeFile(pagePath, `${await readFile(pagePath, "utf8")} `);

    await assert.rejects(
      () => verifyBuiltFeed({
        manifestPath: path.join(outputDir, "manifest.json"),
        pagesDir: path.join(outputDir, "pages"),
      }),
      /hash/i,
    );
  });
});
