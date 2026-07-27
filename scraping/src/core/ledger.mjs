import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export function canonicalUrl(value) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href;
}

function ledgerFile(root, siteId) {
  return path.join(root, "scraping", "state", `${siteId}.jsonl`);
}

async function existingCandidates(root, siteId) {
  const directory = path.join(root, "scraping", "output", siteId);
  let files;
  try { files = await readdir(directory); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const name of files.filter((file) => file.endsWith(".json"))) {
    try {
      const candidate = JSON.parse(await readFile(path.join(directory, name), "utf8"));
      if (candidate.source?.url) records.push({
        url: canonicalUrl(candidate.source.url),
        scraped_at: candidate.source.retrieved_at || null,
        output: path.join("scraping", "output", siteId, name),
        recovered: true
      });
    } catch { /* leave malformed candidates for manual review */ }
  }
  return records;
}

export async function loadLedger(root, siteId) {
  const file = ledgerFile(root, siteId);
  let records = [];
  try {
    const text = await readFile(file, "utf8");
    records = text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const known = new Set(records.map((record) => canonicalUrl(record.url)));
  const recovered = (await existingCandidates(root, siteId)).filter((record) => !known.has(record.url));
  if (recovered.length) {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, recovered.map((record) => JSON.stringify(record)).join("\n") + "\n");
    recovered.forEach((record) => known.add(record.url));
  }
  return { file, urls: known, recovered: recovered.length };
}

export async function recordScraped(root, siteId, url, outputFiles) {
  const file = ledgerFile(root, siteId);
  const record = {
    url: canonicalUrl(url),
    scraped_at: new Date().toISOString(),
    output: outputFiles
  };
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`);
  return record;
}

