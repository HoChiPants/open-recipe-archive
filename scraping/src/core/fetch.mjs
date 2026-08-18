import { gunzipSync } from "node:zlib";
import { USER_AGENT } from "./utils.mjs";

export async function fetchText(url, { timeoutMs = 20000 } = {}) {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xml,text/plain;q=0.9,*/*;q=0.1" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText} for ${url}`);
    error.status = response.status;
    error.url = response.url || url;
    throw error;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const body = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  return { text: body.toString("utf8"), finalUrl: response.url, contentType: response.headers.get("content-type") || "" };
}
