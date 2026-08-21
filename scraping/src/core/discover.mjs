import { fetchText } from "./fetch.mjs";
import { isAllowed } from "./robots.mjs";
import { sleep, unique } from "./utils.mjs";

export function urlsFromDocument(text, baseUrl) {
  const values = [];
  for (const match of text.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) values.push(match[1].trim().replace(/&amp;/g, "&"));
  for (const match of text.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
    try { values.push(new URL(match[1] ?? match[2] ?? match[3], baseUrl).href); } catch { /* malformed link */ }
  }
  return unique(values);
}

function blocked(parsed, site) {
  return (site.block || []).some((part) => parsed.pathname.includes(part));
}

export function configured(url, site) {
  const parsed = new URL(url);
  if (parsed.host !== new URL(site.baseUrl).host) return false;
  if (blocked(parsed, site)) return false;
  return !(site.allow || []).length || site.allow.some((part) => parsed.pathname.includes(part));
}

export function followable(url, site) {
  const parsed = new URL(url);
  if (parsed.host !== new URL(site.baseUrl).host || blocked(parsed, site)) return false;
  const value = `${parsed.pathname}${parsed.search}`;
  return (site.follow || []).some((part) => value.includes(part));
}

function sitemapAllowed(url, site) {
  const parsed = new URL(url);
  const hosts = new Set([new URL(site.baseUrl).host, ...(site.sitemapHosts || [])]);
  if (!hosts.has(parsed.host)) return false;
  return !(site.sitemapAllow || []).length || site.sitemapAllow.some((part) => parsed.href.includes(part));
}

export function configuredSeeds(site) {
  const seeds = [...site.seeds];
  if (site.pagination?.template) {
    const start = Math.max(1, Number(site.pagination.start) || 1);
    const end = Math.max(start, Number(site.pagination.end) || start);
    for (let page = start; page <= end; page++) seeds.push(site.pagination.template.replaceAll("{page}", page));
  }
  return unique(seeds);
}

export async function discover(site, robots, {
  acceptRecipe = () => true,
  recipeKey = (url) => url,
  fetchPage = fetchText,
  wait = sleep,
  onFetch = () => {},
  onError = () => {},
  onComplete = () => {}
} = {}) {
  const pending = configuredSeeds(site);
  const visited = new Set();
  const recipes = [];
  const recipeUrls = new Set();
  let blockedPages = 0;
  let failedPages = 0;
  let fetchedPages = 0;
  let skippedRecipes = 0;
  while (pending.length && recipes.length < site.maxPages) {
    const url = pending.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    if (!isAllowed(url, robots)) {
      blockedPages++;
      continue;
    }
    onFetch(url);
    await wait(Math.max(1000, site.delayMs || 2000, robots?.group?.delayMs || 0));
    let page;
    try {
      page = await fetchPage(url);
      fetchedPages++;
    } catch (error) {
      failedPages++;
      onError(url, error);
      continue;
    }
    const { text, contentType } = page;
    for (const found of urlsFromDocument(text, url)) {
      if (/\.xml(?:\.gz)?(?:$|\?)/i.test(new URL(found).pathname) || contentType.includes("xml") && found.includes("sitemap")) {
        if (!visited.has(found) && sitemapAllowed(found, site)) pending.push(found);
      } else if (configured(found, site)) {
        const key = recipeKey(found);
        if (!recipeUrls.has(key)) {
          recipeUrls.add(key);
          if (acceptRecipe(found)) recipes.push(found);
          else skippedRecipes++;
        }
      } else if (followable(found, site) && !visited.has(found)) pending.push(found);
      if (recipes.length >= site.maxPages) break;
    }
  }
  const result = unique(recipes).slice(0, site.maxPages);
  onComplete({
    acceptedRecipes: result.length,
    blockedPages,
    candidateRecipes: recipeUrls.size,
    failedPages,
    fetchedPages,
    reachedLimit: result.length >= site.maxPages,
    skippedRecipes,
    sourceQueueExhausted: pending.length === 0 && result.length < site.maxPages,
    visitedPages: visited.size
  });
  return result;
}
