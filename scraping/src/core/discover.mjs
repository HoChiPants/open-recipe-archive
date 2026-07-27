import { fetchText } from "./fetch.mjs";
import { isAllowed } from "./robots.mjs";
import { sleep, unique } from "./utils.mjs";

function urlsFromDocument(text, baseUrl) {
  const values = [];
  for (const match of text.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) values.push(match[1].trim().replace(/&amp;/g, "&"));
  for (const match of text.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try { values.push(new URL(match[1], baseUrl).href); } catch { /* malformed link */ }
  }
  return unique(values);
}

function configured(url, site) {
  const parsed = new URL(url);
  if (parsed.host !== new URL(site.baseUrl).host) return false;
  if ((site.block || []).some((part) => parsed.pathname.includes(part))) return false;
  return !(site.allow || []).length || site.allow.some((part) => parsed.pathname.includes(part));
}

export async function discover(site, robots, { onFetch = () => {} } = {}) {
  const pending = [...site.seeds];
  const visited = new Set();
  const recipes = [];
  while (pending.length && recipes.length < site.maxPages) {
    const url = pending.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    if (!isAllowed(url, robots)) continue;
    onFetch(url);
    await sleep(Math.max(1000, site.delayMs || 2000, robots?.group?.delayMs || 0));
    const { text, contentType } = await fetchText(url);
    for (const found of urlsFromDocument(text, url)) {
      if (/\.xml(?:\.gz)?(?:$|\?)/i.test(new URL(found).pathname) || contentType.includes("xml") && found.includes("sitemap")) {
        if (!visited.has(found) && new URL(found).host === new URL(site.baseUrl).host) pending.push(found);
      } else if (configured(found, site)) recipes.push(found);
      if (recipes.length >= site.maxPages) break;
    }
  }
  return unique(recipes).slice(0, site.maxPages);
}
