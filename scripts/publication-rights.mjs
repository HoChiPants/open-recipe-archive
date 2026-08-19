import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { formatAjvErrors, readJson, root } from "./library.mjs";
import { normalizeHostname } from "./publication-review-lib.mjs";

const args = process.argv.slice(2);
const valueFor = (flag, fallback = "") => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};
const file = path.resolve(root, valueFor("--file", "scraping/config/publication-rights.json"));
const schema = await readJson(path.join(root, "schemas", "publication-rights.schema.json"));
const policy = JSON.parse(await readFile(file, "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
if (!validate(policy)) throw new Error(`invalid rights policy: ${formatAjvErrors(validate.errors)}`);

function requireValid(value, message) {
  if (!value) throw new Error(message);
  return value;
}

if (args.includes("--list") || !args.includes("--approve") && !args.includes("--draft-only")) {
  const rows = Object.entries(policy.sources).map(([source, entry]) => ({ source, status: entry.status, basis: entry.basis, reviewed_at: entry.reviewed_at || "-" }));
  if (rows.length) console.table(rows);
  else console.log("No source rights have been recorded. Every source is currently draft-only.");
  process.exit(0);
}

const hostname = normalizeHostname(requireValid(valueFor("--source"), "--source must be a domain or URL"));
if (!hostname) throw new Error("--source must be a valid domain or URL, such as https://example.com");
const previous = policy.sources[hostname] ?? {};

if (args.includes("--approve")) {
  const allowed = new Set(["first-party", "public-domain", "cc0", "compatible-license", "written-permission"]);
  const basis = valueFor("--basis");
  if (!allowed.has(basis)) throw new Error(`--basis must be one of: ${[...allowed].join(", ")}`);
  const evidence = requireValid(valueFor("--evidence"), "--approve requires --evidence with a license, permission, or ownership record reference");
  policy.sources[hostname] = {
    status: "approved",
    basis,
    evidence,
    reviewed_at: valueFor("--reviewed-at", new Date().toISOString().slice(0, 10)),
    expires_at: valueFor("--expires-at", ""),
    max_per_run: Number(valueFor("--max-per-run", previous.max_per_run ?? 0)),
    max_catalog_recipes: Number(valueFor("--max-catalog-recipes", previous.max_catalog_recipes ?? 0)),
    notes: valueFor("--notes", previous.notes ?? ""),
  };
} else {
  policy.sources[hostname] = {
    status: "draft-only",
    basis: "unverified",
    evidence: "",
    reviewed_at: "",
    expires_at: "",
    max_per_run: 0,
    max_catalog_recipes: 0,
    notes: valueFor("--notes", previous.notes ?? ""),
  };
}

if (!validate(policy)) throw new Error(`invalid rights policy after update: ${formatAjvErrors(validate.errors)}`);
await writeFile(file, `${JSON.stringify(policy, null, 2)}\n`);
console.log(`${hostname} is now ${policy.sources[hostname].status}.`);
