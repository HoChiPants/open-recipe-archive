import { fetchText } from "./fetch.mjs";

const BOT_NAME = "openrecipearchivebot";

function ruleMatches(pathname, rule) {
  if (!rule) return false;
  const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\$$/, "$");
  return new RegExp(`^${escaped}`).test(pathname);
}

export function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (!current || current.hasRules) {
        current = { agents: [], allow: [], disallow: [], delayMs: 0, hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && key === "allow") {
      current.allow.push(value);
      current.hasRules = true;
    } else if (current && key === "disallow") {
      current.disallow.push(value);
      current.hasRules = true;
    } else if (current && key === "crawl-delay") {
      current.delayMs = Math.ceil(Number(value) * 1000) || 0;
      current.hasRules = true;
    }
  }
  const explicit = groups.filter((item) => item.agents.some((agent) => agent !== "*" && BOT_NAME.startsWith(agent)));
  const matching = explicit.length ? explicit : groups.filter((item) => item.agents.includes("*"));
  if (!matching.length) return null;
  return {
    agents: matching.flatMap((item) => item.agents),
    allow: matching.flatMap((item) => item.allow),
    disallow: matching.flatMap((item) => item.disallow),
    delayMs: Math.max(...matching.map((item) => item.delayMs))
  };
}

export async function loadRobots(baseUrl) {
  const robotsUrl = new URL("/robots.txt", baseUrl).href;
  try {
    const { text } = await fetchText(robotsUrl);
    return { found: true, group: parseRobots(text), robotsUrl };
  } catch (error) {
    return { found: false, group: null, robotsUrl, warning: error.message };
  }
}

export function isAllowed(url, robots) {
  if (!robots?.group) return true;
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  const matches = [
    ...robots.group.allow.map((rule) => ({ rule, allowed: true })),
    ...robots.group.disallow.map((rule) => ({ rule, allowed: false }))
  ].filter(({ rule }) => ruleMatches(path, rule)).sort((a, b) => b.rule.length - a.rule.length);
  return matches[0]?.allowed ?? true;
}
