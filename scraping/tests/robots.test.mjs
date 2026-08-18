import assert from "node:assert/strict";
import test from "node:test";
import { isAllowed, parseRobots } from "../src/core/robots.mjs";

test("robots rules use the longest matching path", () => {
  const robots = { group: { allow: ["/recipes/public/"], disallow: ["/recipes/"] } };
  assert.equal(isAllowed("https://example.com/recipes/private/soup", robots), false);
  assert.equal(isAllowed("https://example.com/recipes/public/soup", robots), true);
  assert.equal(isAllowed("https://example.com/about", robots), true);
});

test("merges repeated wildcard groups and matches query rules", () => {
  const group = parseRobots(`
User-agent: *
Disallow: /private
User-agent: *
Allow: /private/public
Disallow: /*?preview=
  `);
  const robots = { group };
  assert.equal(isAllowed("https://example.com/private/file", robots), false);
  assert.equal(isAllowed("https://example.com/private/public/file", robots), true);
  assert.equal(isAllowed("https://example.com/post?preview=true", robots), false);
});

test("uses explicit crawler rules instead of wildcard rules", () => {
  const group = parseRobots(`
User-agent: *
Disallow: /shared
User-agent: OpenRecipeArchiveBot
Disallow: /crawler-only
  `);
  const robots = { group };
  assert.equal(isAllowed("https://example.com/shared", robots), true);
  assert.equal(isAllowed("https://example.com/crawler-only", robots), false);
});
