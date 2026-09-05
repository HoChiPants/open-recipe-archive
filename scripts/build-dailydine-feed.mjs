import path from "node:path";

import { buildDailyDineFeed, verifyBuiltFeed } from "./dailydine-feed-lib.mjs";

function usage() {
  return "Usage: npm run dailydine:feed -- --release <release-id> [--input <directory>] [--output <directory>] [--as-of <ISO-8601>] [--page-size <positive integer>]";
}

function parseArguments(argv) {
  const options = {
    input: "recipes",
    output: "build/dailydine-feed",
    pageSize: 250,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { help: true };
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument '${argument}'. ${usage()}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for '${argument}'. ${usage()}`);
    index += 1;
    if (argument === "--release") options.release = value;
    else if (argument === "--input") options.input = value;
    else if (argument === "--output") options.output = value;
    else if (argument === "--as-of") options.asOf = value;
    else if (argument === "--page-size") options.pageSize = Number(value);
    else throw new Error(`Unknown option '${argument}'. ${usage()}`);
  }
  if (!options.release) throw new Error(`--release is required. ${usage()}`);
  if (!Number.isInteger(options.pageSize) || options.pageSize < 1) throw new Error("--page-size must be a positive integer");
  return options;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    process.exit(0);
  }
  const outputDir = path.resolve(options.output);
  const manifest = await buildDailyDineFeed({
    inputDir: path.resolve(options.input),
    outputDir,
    releaseId: options.release,
    generatedAt: options.asOf ?? new Date().toISOString(),
    pageSize: options.pageSize,
  });
  await verifyBuiltFeed({ manifestPath: path.join(outputDir, "manifest.json"), pagesDir: path.join(outputDir, "pages") });
  console.log(`Daily Dine feed ${manifest.release_id}: ${manifest.total_records} records across ${manifest.total_pages} pages.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
