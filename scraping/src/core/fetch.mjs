import { USER_AGENT } from "./utils.mjs";

export async function fetchText(url, { timeoutMs = 20000 } = {}) {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xml,text/plain;q=0.9,*/*;q=0.1" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return { text: await response.text(), finalUrl: response.url, contentType: response.headers.get("content-type") || "" };
}

