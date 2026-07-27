import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hash, slugify } from "./utils.mjs";

export async function storeCandidate(root, siteId, candidate, { overwrite = false } = {}) {
  const directory = path.join(root, "scraping", "output", siteId);
  await mkdir(directory, { recursive: true });
  const filename = `${slugify(candidate.extracted.name)}-${hash(candidate.source.url)}.json`;
  const file = path.join(directory, filename);
  if (!overwrite) {
    try { await access(file); return { file, skipped: true }; } catch { /* new candidate */ }
  }
  await writeFile(file, `${JSON.stringify(candidate, null, 2)}\n`);
  return { file, skipped: false };
}

