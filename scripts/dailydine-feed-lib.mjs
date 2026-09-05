import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { formatAjvErrors, jsonFiles, readJson, root } from "./library.mjs";
import { slug } from "./recipe-pipeline-lib.mjs";

const schema = await readJson(path.join(root, "schemas/dailydine-feed.schema.json"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(schema);
const validateManifest = ajv.getSchema(`${schema.$id}#/$defs/manifest`);
const validatePage = ajv.getSchema(`${schema.$id}#/$defs/page`);

export function compareUnicodeCodePoints(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) => character.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

export function canonicalSourceUrl(value) {
  const url = new URL(requireString(value, "source URL"));
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("source URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) throw new Error("source URL must not contain credentials");
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";
  return url.toString();
}

function sourceUrlDetails(recipe) {
  const normalizedUrl = canonicalSourceUrl(requireString(recipe?.source?.url, "recipe.source.url"));
  return {
    host: new URL(normalizedUrl).hostname,
    normalizedUrl,
  };
}

function ingredientLine(ingredient) {
  const amount = [ingredient.quantity, ingredient.unit].filter((value) => value !== undefined && value !== "").join(" ");
  const item = `${amount ? `${amount} ` : ""}${ingredient.item}`;
  const preparation = ingredient.preparation ? `, ${ingredient.preparation}` : "";
  const optional = ingredient.optional ? " (optional)" : "";
  return `${item}${preparation}${optional}`;
}

function retrievedAt(recipe) {
  if (recipe.normalization?.transformed_at) return recipe.normalization.transformed_at;
  return `${requireString(recipe.updated_at, "recipe.updated_at")}T00:00:00.000Z`;
}

function feedRecordForRecipe(recipe) {
  const { normalizedUrl } = sourceUrlDetails(recipe);
  return {
    archive_id: archiveIdForRecipe(recipe),
    content_hash: "",
    slug: slug(requireString(recipe.id ?? recipe.name, "recipe.id or name")),
    review_status: "normalized-and-reviewed",
    source: {
      name: requireString(recipe?.source?.name, "recipe.source.name"),
      url: normalizedUrl,
      retrieved_at: retrievedAt(recipe),
    },
    name: requireString(recipe.name, "recipe.name"),
    description: typeof recipe.description === "string" ? recipe.description : "",
    yield: recipe.yield,
    times: {
      prep_minutes: recipe.times?.prep_minutes,
      cook_minutes: recipe.times?.cook_minutes,
      inactive_minutes: recipe.times?.inactive_minutes ?? 0,
    },
    ingredient_lines: (recipe.ingredients ?? []).map(ingredientLine),
    instruction_lines: (recipe.instructions ?? []).map((instruction) => instruction.text),
    categories: recipe.tags ?? [],
    nutrition: recipe.nutrition ?? null,
    normalization: recipe.normalization,
  };
}

export function archiveIdForRecipe(recipe) {
  const { host, normalizedUrl } = sourceUrlDetails(recipe);
  const sourceUrlHash = sha256(normalizedUrl);
  return `${host}:${sourceUrlHash.slice(0, 24)}`;
}

function contentHashForRecord(record) {
  const content = structuredClone(record);
  Reflect.deleteProperty(content, "content_hash");
  Reflect.deleteProperty(content.source, "retrieved_at");
  return sha256(canonicalJson(content));
}

export function contentHashForRecipe(recipe) {
  return contentHashForRecord(feedRecordForRecipe(recipe));
}

function recordForRecipe(recipe) {
  const record = feedRecordForRecipe(recipe);
  record.content_hash = contentHashForRecipe(recipe);
  return record;
}

function isFeedEligible(recipe) {
  const normalization = recipe?.normalization;
  return Boolean(
    recipe?.source?.url
    && normalization?.requires_review === false
    && normalization?.source_review_status === "passed"
    && /^[a-f0-9]{64}$/.test(normalization?.source_text_hash ?? "")
    && /^[a-f0-9]{64}$/.test(normalization?.normalized_text_hash ?? ""),
  );
}

function assertValid(validator, value, label) {
  if (!validator(value)) throw new Error(`${label} schema validation failed: ${formatAjvErrors(validator.errors)}`);
}

function validateBuildOptions({ inputDir, outputDir, releaseId, generatedAt, pageSize }) {
  requireString(inputDir, "inputDir");
  requireString(outputDir, "outputDir");
  requireString(releaseId, "releaseId");
  requireString(generatedAt, "generatedAt");
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("pageSize must be a positive integer");
}

async function promoteFeed(stagingDir, outputDir) {
  const parentDir = path.dirname(outputDir);
  const backupDir = path.join(parentDir, `.${path.basename(outputDir)}.backup-${randomUUID()}`);
  let previousOutputMoved = false;
  try {
    await rename(outputDir, backupDir);
    previousOutputMoved = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  try {
    await rename(stagingDir, outputDir);
  } catch (error) {
    if (previousOutputMoved) await rename(backupDir, outputDir);
    throw error;
  }

  if (previousOutputMoved) await rm(backupDir, { recursive: true, force: true });
}

export async function buildDailyDineFeed({ inputDir, outputDir, releaseId, generatedAt, pageSize }) {
  validateBuildOptions({ inputDir, outputDir, releaseId, generatedAt, pageSize });
  const recipes = [];
  for (const file of await jsonFiles(inputDir)) recipes.push(await readJson(file));
  const records = recipes.filter(isFeedEligible).map(recordForRecipe)
    .sort((left, right) => compareUnicodeCodePoints(left.archive_id, right.archive_id));
  const seenIds = new Set();
  const seenSourceUrls = new Set();
  for (const record of records) {
    if (seenSourceUrls.has(record.source.url)) throw new Error(`duplicate canonical source URL '${record.source.url}'`);
    seenSourceUrls.add(record.source.url);
    if (seenIds.has(record.archive_id)) throw new Error(`duplicate archive_id '${record.archive_id}'`);
    seenIds.add(record.archive_id);
  }

  const outputParent = path.dirname(outputDir);
  await mkdir(outputParent, { recursive: true });
  const stagingDir = await mkdtemp(path.join(outputParent, `.${path.basename(outputDir)}.tmp-`));
  try {
    const pages = [];
    const pagesDir = path.join(stagingDir, "pages");
    await mkdir(pagesDir, { recursive: true });
    for (let offset = 0; offset < records.length; offset += pageSize) {
      const pageNumber = pages.length + 1;
      const recipes = records.slice(offset, offset + pageSize);
      const page = { schema_version: "1.1.0", release_id: releaseId, page: pageNumber, recipes };
      assertValid(validatePage, page, `page ${pageNumber}`);
      const file = `page-${String(pageNumber).padStart(5, "0")}.json`;
      const bytes = Buffer.from(`${canonicalJson(page)}\n`, "utf8");
      await writeFile(path.join(pagesDir, file), bytes);
      pages.push({
        page: pageNumber,
        file,
        record_count: recipes.length,
        sha256: sha256(bytes),
        archive_id_start: recipes[0].archive_id,
        archive_id_end: recipes.at(-1).archive_id,
      });
    }

    const unsignedManifest = {
      schema_version: "1.1.0",
      release_id: releaseId,
      generated_at: generatedAt,
      total_records: records.length,
      total_pages: pages.length,
      pages,
    };
    const manifest = { ...unsignedManifest, manifest_hash: sha256(canonicalJson(unsignedManifest)) };
    assertValid(validateManifest, manifest, "manifest");
    await writeFile(path.join(stagingDir, "manifest.json"), `${canonicalJson(manifest)}\n`);
    await verifyBuiltFeed({ manifestPath: path.join(stagingDir, "manifest.json"), pagesDir });
    await promoteFeed(stagingDir, outputDir);
    return manifest;
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

export async function verifyBuiltFeed({ manifestPath, pagesDir }) {
  requireString(manifestPath, "manifestPath");
  requireString(pagesDir, "pagesDir");
  const manifest = await readJson(manifestPath);
  assertValid(validateManifest, manifest, "manifest");
  const { manifest_hash, ...unsignedManifest } = manifest;
  if (manifest_hash !== sha256(canonicalJson(unsignedManifest))) throw new Error("manifest hash does not match canonical manifest JSON");
  if (manifest.total_pages !== manifest.pages.length) throw new Error("manifest total_pages does not match page descriptors");

  const seenIds = new Set();
  const seenSourceUrls = new Set();
  let totalRecords = 0;
  for (const [index, descriptor] of manifest.pages.entries()) {
    const expectedPage = index + 1;
    if (descriptor.page !== expectedPage) throw new Error(`page descriptor ${expectedPage} has page ${descriptor.page}`);
    const expectedFile = `page-${String(expectedPage).padStart(5, "0")}.json`;
    if (descriptor.file !== expectedFile) throw new Error(`page descriptor ${expectedPage} has unexpected file '${descriptor.file}'`);
    const pageBytes = await readFile(path.join(pagesDir, descriptor.file));
    if (sha256(pageBytes) !== descriptor.sha256) throw new Error(`page ${expectedPage} hash does not match declared sha256`);
    const page = JSON.parse(pageBytes.toString("utf8"));
    assertValid(validatePage, page, `page ${expectedPage}`);
    if (page.release_id !== manifest.release_id) throw new Error(`page ${expectedPage} release_id does not match manifest`);
    if (page.page !== expectedPage) throw new Error(`page ${expectedPage} number does not match manifest`);
    if (page.recipes.length !== descriptor.record_count) throw new Error(`page ${expectedPage} record_count does not match descriptor`);
    if (page.recipes[0]?.archive_id !== descriptor.archive_id_start || page.recipes.at(-1)?.archive_id !== descriptor.archive_id_end) {
      throw new Error(`page ${expectedPage} archive ID range does not match descriptor`);
    }
    for (const recipe of page.recipes) {
      const sourceUrl = canonicalSourceUrl(recipe.source.url);
      if (recipe.source.url !== sourceUrl) throw new Error(`recipe '${recipe.archive_id}' source URL is not canonical`);
      if (seenSourceUrls.has(sourceUrl)) throw new Error(`duplicate canonical source URL '${sourceUrl}' in feed`);
      seenSourceUrls.add(sourceUrl);
      const expectedArchiveId = `${new URL(sourceUrl).hostname}:${sha256(sourceUrl).slice(0, 24)}`;
      if (recipe.archive_id !== expectedArchiveId) throw new Error(`recipe '${recipe.archive_id}' archive_id does not match its canonical source URL`);
      if (seenIds.has(recipe.archive_id)) throw new Error(`duplicate archive_id '${recipe.archive_id}' in feed`);
      seenIds.add(recipe.archive_id);
      if (recipe.content_hash !== contentHashForRecord(recipe)) {
        throw new Error(`recipe '${recipe.archive_id}' content_hash does not match its content`);
      }
      if (recipe.normalization.requires_review || recipe.normalization.source_review_status !== "passed") {
        throw new Error(`recipe '${recipe.archive_id}' is not cleared for publication`);
      }
    }
    totalRecords += page.recipes.length;
  }
  if (manifest.total_records !== totalRecords) throw new Error("manifest total_records does not match page records");
  return manifest;
}
