#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(thisFile), "../..");
const configFile = path.join(root, "scraping/config/sites.json");
const scraperFile = path.join(root, "scraping/src/cli.mjs");
const MAX_CONCURRENCY = 8;

function positiveInteger(value, name, maximum = Number.POSITIVE_INFINITY) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    const range = Number.isFinite(maximum) ? ` between 1 and ${maximum}` : " greater than 0";
    throw new Error(`${name} must be an integer${range}.`);
  }
  return parsed;
}

function commaSeparated(value, name) {
  const values = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (!values.length) throw new Error(`${name} must contain at least one site ID.`);
  return values;
}

function optionValue(args, index, inlineValue) {
  if (inlineValue !== undefined) return { value: inlineValue, nextIndex: index };
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${args[index]} requires a value.`);
  return { value, nextIndex: index + 1 };
}

export function parseArgs(args) {
  const options = {
    limit: 25,
    concurrency: 3,
    sites: null,
    exclude: [],
    dryRun: false,
    overwrite: false,
    list: false,
    help: false
  };

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const equalsIndex = argument.indexOf("=");
    const name = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);

    if (["--limit", "--concurrency", "--sites", "--exclude"].includes(name)) {
      const result = optionValue(args, index, inlineValue);
      index = result.nextIndex;
      if (name === "--limit") options.limit = positiveInteger(result.value, "--limit");
      if (name === "--concurrency") options.concurrency = positiveInteger(result.value, "--concurrency", MAX_CONCURRENCY);
      if (name === "--sites") options.sites = commaSeparated(result.value, "--sites");
      if (name === "--exclude") options.exclude = commaSeparated(result.value, "--exclude");
      continue;
    }

    if (name === "--dry-run") options.dryRun = true;
    else if (name === "--overwrite") options.overwrite = true;
    else if (name === "--list") options.list = true;
    else if (name === "--help" || name === "-h") options.help = true;
    else throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

export function selectSites(configuredIds, { sites, exclude = [] }) {
  const known = new Set(configuredIds);
  const requested = sites || configuredIds;
  const unknown = [...requested, ...exclude].filter((site) => !known.has(site));
  if (unknown.length) throw new Error(`Unknown site ID(s): ${[...new Set(unknown)].join(", ")}`);

  const excluded = new Set(exclude);
  const selected = requested.filter((site) => !excluded.has(site));
  if (!selected.length) throw new Error("No sites remain after applying --sites and --exclude.");
  return selected;
}

export async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => consume()
  );
  await Promise.all(workers);
  return results;
}

export function parseScrapeStatus(line) {
  const marker = "SCRAPE_STATUS ";
  if (!line.startsWith(marker)) return null;
  try { return JSON.parse(line.slice(marker.length)); } catch { return null; }
}

function prefixOutput(input, siteId, output, onLine = () => {}) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  lines.on("line", (line) => {
    onLine(line);
    output.write(`[${siteId}] ${line}\n`);
  });
}

function runSite(siteId, options, activeChildren) {
  const startedAt = Date.now();
  const args = [scraperFile, "--site", siteId, "--limit", String(options.limit)];
  if (options.dryRun) args.push("--dry-run");
  if (options.overwrite) args.push("--overwrite");

  console.log(`[${siteId}] Starting`);
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  activeChildren.add(child);
  let scrapeStatus = null;
  prefixOutput(child.stdout, siteId, process.stdout, (line) => {
    scrapeStatus = parseScrapeStatus(line) || scrapeStatus;
  });
  prefixOutput(child.stderr, siteId, process.stderr);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      activeChildren.delete(child);
      resolve({ siteId, durationMs: Date.now() - startedAt, scrapeStatus, ...result });
    };

    child.once("error", (error) => finish({ code: 1, error: error.message }));
    child.once("close", (code, signal) => finish({ code: code ?? 1, signal }));
  });
}

function usage() {
  return `Run configured recipe scrapers with bounded cross-site concurrency.

Usage:
  npm run scrape:sites -- [options]

Options:
  --limit <number>         Candidate URLs per site (default: 25)
  --concurrency <number>   Sites to run at once, 1-${MAX_CONCURRENCY} (default: 3)
  --sites <id,id,...>      Run only these site IDs
  --exclude <id,id,...>    Skip these site IDs
  --dry-run                Discover and print URLs without fetching recipe pages
  --overwrite              Pass overwrite mode to each site scraper
  --list                   List configured site IDs and exit
  --help                   Show this help
`;
}

async function loadSites() {
  const config = JSON.parse(await readFile(configFile, "utf8"));
  if (!Array.isArray(config.sites) || !config.sites.length) {
    throw new Error(`No sites are configured in ${configFile}`);
  }
  return config.sites;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage());
    return;
  }

  const configuredSites = await loadSites();
  if (options.list) {
    for (const site of configuredSites) console.log(`${site.id}\t${site.name}`);
    return;
  }

  const selectedIds = selectSites(configuredSites.map((site) => site.id), options);
  const activeChildren = new Set();
  let interruptedSignal = null;
  const handleSignal = (signal) => {
    if (interruptedSignal) return;
    interruptedSignal = signal;
    console.error(`\nReceived ${signal}; stopping active scrapers...`);
    for (const child of activeChildren) child.kill("SIGTERM");
  };
  const onSigint = () => handleSignal("SIGINT");
  const onSigterm = () => handleSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  console.log(`Running ${selectedIds.length} site(s), up to ${options.concurrency} at once, limit ${options.limit} per site.`);
  const startedAt = Date.now();
  let results;
  try {
    results = await runPool(selectedIds, options.concurrency, (siteId) => {
      if (interruptedSignal) return { siteId, skipped: true, durationMs: 0 };
      return runSite(siteId, options, activeChildren);
    });
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }

  console.log(`\nSummary (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
  for (const result of results) {
    const duration = `${(result.durationMs / 1000).toFixed(1)}s`;
    if (result.skipped) console.log(`SKIP  ${result.siteId}`);
    else if (result.code === 0 && result.scrapeStatus?.state === "exhausted") {
      const detail = result.scrapeStatus.newCandidates
        ? `final discovered batch ${result.scrapeStatus.newCandidates}; end of sources reached`
        : "no new recipe URLs remain";
      console.log(`DONE  ${result.siteId} (${duration}, ${detail})`);
    } else if (result.code === 0 && result.scrapeStatus?.state === "incomplete") {
      const problems = result.scrapeStatus.failedPages + result.scrapeStatus.blockedPages;
      console.log(`WARN  ${result.siteId} (${duration}, could not confirm exhaustion; ${problems} discovery problem(s))`);
    } else if (result.code === 0) console.log(`OK    ${result.siteId} (${duration})`);
    else {
      const detail = result.error || (result.signal ? `signal ${result.signal}` : `exit ${result.code}`);
      console.log(`FAIL  ${result.siteId} (${duration}, ${detail})`);
    }
  }

  if (interruptedSignal) process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
  else if (results.some((result) => result.code !== 0)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
