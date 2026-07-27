import { fetchText } from "./fetch.mjs";

function ruleMatches(pathname, rule) {
  if (!rule) return false;
  const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\$$/, "$");
  return new RegExp(`^${escaped}`).test(pathname);
}

export async function loadRobots(baseUrl) {
  const robotsUrl = new URL("/robots.txt", baseUrl).href;
  try {
    const { text } = await fetchText(robotsUrl);
    const groups = [];
    let current = null;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trim();
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (key === "user-agent") {
        current = { agent: value.toLowerCase(), allow: [], disallow: [], delayMs: 0 };
        groups.push(current);
      } else if (current && key === "allow") current.allow.push(value);
      else if (current && key === "disallow") current.disallow.push(value);
      else if (current && key === "crawl-delay") current.delayMs = Math.ceil(Number(value) * 1000) || 0;
    }
    const group = groups.find((item) => item.agent.includes("openrecipearchivebot")) || groups.find((item) => item.agent === "*");
    return { found: true, group, robotsUrl };
  } catch (error) {
    return { found: false, group: null, robotsUrl, warning: error.message };
  }
}

export function isAllowed(url, robots) {
  if (!robots?.group) return true;
  const path = new URL(url).pathname;
  const matches = [
    ...robots.group.allow.map((rule) => ({ rule, allowed: true })),
    ...robots.group.disallow.map((rule) => ({ rule, allowed: false }))
  ].filter(({ rule }) => ruleMatches(path, rule)).sort((a, b) => b.rule.length - a.rule.length);
  return matches[0]?.allowed ?? true;
}

