import { createHash } from "node:crypto";

export const USER_AGENT = "OpenRecipeArchiveBot/0.1 (+local research; respectful crawler)";

export function slugify(value) {
  return String(value ?? "recipe")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "recipe";
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function parseDuration(value) {
  if (!value) return 0;
  const match = String(value).match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i);
  return match ? Number(match[1] || 0) * 1440 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

