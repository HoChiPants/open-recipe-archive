import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { formatAjvErrors, jsonFiles, readJson, root } from "./library.mjs";
import { slug } from "./recipe-pipeline-lib.mjs";

const schema = await readJson(path.join(root, "schemas/dailydine-feed.schema.json"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(schema);
const validateManifest = ajv.getSchema(`${schema.$id}#/$defs/manifest`);
const validatePage = ajv.getSchema(`${schema.$id}#/$defs/page`);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
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

function feedRecordForCandidate(candidate) {
  const extracted = candidate?.extracted ?? {};
  return {
    archive_id: archiveIdForCandidate(candidate),
    content_hash: "",
    review_status: requireString(candidate?.review_status, "candidate.review_status"),
    source: {
      name: requireString(candidate?.source?.name, "candidate.source.name"),
      url: requireString(candidate?.source?.url, "candidate.source.url"),
      retrieved_at: requireString(candidate?.source?.retrieved_at, "candidate.source.retrieved_at"),
    },
    name: requireString(extracted.name, "candidate.extracted.name"),
    description: typeof extracted.description === "string" ? extracted.description : "",
    yield: {
      quantity: extracted.yield?.quantity,
      unit: extracted.yield?.unit,
    },
    times: {
      prep_minutes: extracted.times?.prep_minutes,
      cook_minutes: extracted.times?.cook_minutes,
      inactive_minutes: extracted.times?.inactive_minutes,
    },
    ingredient_lines: extracted.ingredient_lines ?? [],
    instruction_lines: extracted.instruction_lines ?? [],
    categories: extracted.categories ?? [],
    nutrition: extracted.nutrition ?? null,
  };
}

export function archiveIdForCandidate(candidate) {
  const host = new URL(requireString(candidate?.source?.url, "candidate.source.url"))
    .hostname
    .toLowerCase()
    .replace(/^www\./, "");
  const candidateId = slug(candidate?.extracted?.id ?? candidate?.extracted?.name);
  if (!candidateId) throw new Error("candidate.extracted.id or candidate.extracted.name must produce a slug");
  return `${host}:${candidateId}`;
}

export function contentHashForCandidate(candidate) {
  const record = feedRecordForCandidate(candidate);
  delete record.content_hash;
  delete record.source.retrieved_at;
  return sha256(canonicalJson(record));
}

function recordForCandidate(candidate) {
  const record = feedRecordForCandidate(candidate);
  record.content_hash = contentHashForCandidate(candidate);
  return record;
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

export async function buildDailyDineFeed({ inputDir, outputDir, releaseId, generatedAt, pageSize }) {
  validateBuildOptions({ inputDir, outputDir, releaseId, generatedAt, pageSize });
  const candidates = [];
  for (const file of await jsonFiles(inputDir)) candidates.push(await readJson(file));
  const records = candidates.map(recordForCandidate).sort((left, right) => left.archive_id.localeCompare(right.archive_id));
  const seenIds = new Set();
  for (const record of records) {
    if (seenIds.has(record.archive_id)) throw new Error(`duplicate archive_id '${record.archive_id}'`);
    seenIds.add(record.archive_id);
  }

  const pages = [];
  const pagesDir = path.join(outputDir, "pages");
  await rm(pagesDir, { recursive: true, force: true });
  await mkdir(pagesDir, { recursive: true });
  for (let offset = 0; offset < records.length; offset += pageSize) {
    const pageNumber = pages.length + 1;
    const recipes = records.slice(offset, offset + pageSize);
    const page = { schema_version: "1.0.0", release_id: releaseId, page: pageNumber, recipes };
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
    schema_version: "1.0.0",
    release_id: releaseId,
    generated_at: generatedAt,
    total_records: records.length,
    total_pages: pages.length,
    pages,
  };
  const manifest = { ...unsignedManifest, manifest_hash: sha256(canonicalJson(unsignedManifest)) };
  assertValid(validateManifest, manifest, "manifest");
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "manifest.json"), `${canonicalJson(manifest)}\n`);
  return manifest;
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
      if (seenIds.has(recipe.archive_id)) throw new Error(`duplicate archive_id '${recipe.archive_id}' in feed`);
      seenIds.add(recipe.archive_id);
      if (recipe.content_hash !== contentHashForCandidate({
        review_status: recipe.review_status,
        source: recipe.source,
        extracted: {
          id: recipe.archive_id.split(":").at(-1),
          name: recipe.name,
          description: recipe.description,
          yield: recipe.yield,
          times: recipe.times,
          ingredient_lines: recipe.ingredient_lines,
          instruction_lines: recipe.instruction_lines,
          categories: recipe.categories,
          nutrition: recipe.nutrition,
        },
      })) {
        throw new Error(`recipe '${recipe.archive_id}' content_hash does not match its content`);
      }
    }
    totalRecords += page.recipes.length;
  }
  if (manifest.total_records !== totalRecords) throw new Error("manifest total_records does not match page records");
  return manifest;
}
