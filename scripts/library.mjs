import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const root = path.resolve(new URL("..", import.meta.url).pathname);

export async function jsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await jsonFiles(fullPath)));
    if (entry.isFile() && entry.name.endsWith(".json")) files.push(fullPath);
  }
  return files.sort();
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export function relative(file) {
  return path.relative(root, file);
}

export function formatAjvErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}
