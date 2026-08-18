import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createServer } from "node:http";
import test from "node:test";
import { fetchText } from "../src/core/fetch.mjs";

test("decompresses sitemap files containing gzip bytes", async () => {
  const xml = "<?xml version=\"1.0\"?><urlset><url><loc>https://example.com/recipe/1</loc></url></urlset>";
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/x-gzip" });
    response.end(gzipSync(xml));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const result = await fetchText(`http://127.0.0.1:${address.port}/sitemap.xml.gz`);
    assert.equal(result.text, xml);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("exposes HTTP status and final URL on fetch errors", async () => {
  const server = createServer((request, response) => {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("missing");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/missing`;
    await assert.rejects(
      fetchText(url),
      (error) => error.status === 404 && error.url === url
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
