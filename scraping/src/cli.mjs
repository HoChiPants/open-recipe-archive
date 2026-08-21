#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { extractJsonLd } from "./adapters/json-ld.mjs";
import { extractMicrodata } from "./adapters/microdata.mjs";
import { discover } from "./core/discover.mjs";
import { fetchText } from "./core/fetch.mjs";
import { canonicalUrl, loadLedger, recordScraped } from "./core/ledger.mjs";
import { normalizeCandidate } from "./core/normalize.mjs";
import { isAllowed, loadRobots } from "./core/robots.mjs";
import { classifyScrapeStatus, scrapeStatusMessage } from "./core/scrape-status.mjs";
import { storeCandidate } from "./core/store.mjs";
import { sleep } from "./core/utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name) => args.includes(name);

async function loadSite() {
  const siteArgument = value("--site");
  const directUrl = value("--url") || (/^https?:\/\//i.test(siteArgument || "") ? siteArgument : undefined);
  if (directUrl) {
    const parsed = new URL(directUrl);
    return { id: parsed.hostname.replace(/^www\./, ""), name: parsed.hostname, baseUrl: parsed.origin, seeds: [directUrl], allow: [parsed.pathname], block: [], delayMs: 2000, maxPages: 1, directUrl };
  }
  const configFile = value("--config") || path.join(root, "scraping/config/sites.json");
  let config;
  try {
    config = JSON.parse(await readFile(configFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Site configuration is missing. Copy scraping/config/sites.example.json to scraping/config/sites.json, or pass a recipe page with --url <https://...>.`);
    }
    throw error;
  }
  const siteId = siteArgument;
  const site = config.sites?.find((item) => item.id === siteId);
  if (!site) throw new Error(`Site '${siteId || "(missing)"}' was not found in ${configFile}`);
  return site;
}

async function main() {
  const site = await loadSite();
  const robots = await loadRobots(site.baseUrl);
  if (!robots.found) console.warn(`Warning: could not read ${robots.robotsUrl}: ${robots.warning}`);
  const limit = Math.max(1, Number(value("--limit")) || site.maxPages || 100);
  const ledger = await loadLedger(root, site.id);
  const rememberChecked = async (requestedUrl, finalUrl, outputFiles) => {
    const checked = new Map([requestedUrl, finalUrl].map((url) => [canonicalUrl(url), url]));
    for (const [canonical, url] of checked) {
      if (!ledger.urls.has(canonical)) await recordScraped(root, site.id, url, outputFiles);
      ledger.urls.add(canonical);
    }
  };
  if (ledger.recovered) console.log(`Added ${ledger.recovered} existing candidate URL(s) to the scrape log.`);
  let discoveryStats;
  const discovered = site.directUrl ? [site.directUrl] : await discover({ ...site, maxPages: limit }, robots, {
    acceptRecipe: flag("--overwrite") ? () => true : (url) => !ledger.urls.has(canonicalUrl(url)),
    recipeKey: canonicalUrl,
    onFetch: (url) => console.log(`Discovering ${url}`),
    onError: (url, error) => console.warn(`Discovery failed ${url}: ${error.message}`),
    onComplete: (stats) => { discoveryStats = stats; }
  });
  if (site.directUrl) {
    const alreadyChecked = !flag("--overwrite") && ledger.urls.has(canonicalUrl(site.directUrl));
    discoveryStats = {
      acceptedRecipes: alreadyChecked ? 0 : 1,
      blockedPages: 0,
      candidateRecipes: 1,
      failedPages: 0,
      fetchedPages: 0,
      reachedLimit: !alreadyChecked,
      skippedRecipes: alreadyChecked ? 1 : 0,
      sourceQueueExhausted: alreadyChecked,
      visitedPages: 0
    };
  }
  const alreadyScraped = flag("--overwrite") ? 0 : discoveryStats.skippedRecipes;
  const urls = (flag("--overwrite") ? discovered : discovered.filter((url) => !ledger.urls.has(canonicalUrl(url)))).slice(0, limit);
  console.log(`Found ${urls.length} new candidate URL(s)${alreadyScraped ? `; skipped ${alreadyScraped} already scraped` : ""}.`);
  const scrapeStatus = {
    state: classifyScrapeStatus({ newCandidates: urls.length, requested: limit, discovery: discoveryStats }),
    newCandidates: urls.length,
    requested: limit,
    knownRecipes: ledger.urls.size,
    failedPages: discoveryStats.failedPages,
    blockedPages: discoveryStats.blockedPages,
    sourceQueueExhausted: discoveryStats.sourceQueueExhausted
  };
  console.log(scrapeStatusMessage(site.id, scrapeStatus));
  console.log(`SCRAPE_STATUS ${JSON.stringify(scrapeStatus)}`);
  if (flag("--dry-run") || process.argv[1].endsWith("discover.mjs")) { urls.forEach((url) => console.log(url)); return; }
  const delay = Math.max(1000, site.delayMs || 2000, robots.group?.delayMs || 0);
  let saved = 0;
  for (const url of urls.slice(0, limit)) {
    if (!isAllowed(url, robots)) { console.log(`Blocked by robots.txt: ${url}`); continue; }
    await sleep(delay);
    try {
      const page = await fetchText(url);
      const jsonLd = extractJsonLd(page.text);
      const nodes = jsonLd.length ? jsonLd : extractMicrodata(page.text);
      if (!nodes.length) {
        console.log(`No structured Recipe data; recorded as checked: ${url}`);
        await rememberChecked(url, page.finalUrl, []);
        continue;
      }
      const outputs = [];
      for (const node of nodes) {
        const result = await storeCandidate(root, site.id, normalizeCandidate(node, page.finalUrl, site), { overwrite: flag("--overwrite") });
        console.log(`${result.skipped ? "Exists" : "Saved"}: ${path.relative(root, result.file)}`);
        outputs.push(path.relative(root, result.file));
        if (!result.skipped) saved++;
      }
      await rememberChecked(url, page.finalUrl, outputs);
    } catch (error) {
      console.error(`Failed ${url}: ${error.message}`);
      if (error.status === 404 || error.status === 410) {
        const checkedUrl = error.url || url;
        await rememberChecked(url, checkedUrl, []);
        console.log(`Recorded permanently unavailable URL as checked: ${checkedUrl}`);
      }
    }
  }
  console.log(`Saved ${saved} new candidate(s). Review them before adding recipes.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
