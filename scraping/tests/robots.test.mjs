import assert from "node:assert/strict";
import test from "node:test";
import { isAllowed } from "../src/core/robots.mjs";

test("robots rules use the longest matching path", () => {
  const robots = { group: { allow: ["/recipes/public/"], disallow: ["/recipes/"] } };
  assert.equal(isAllowed("https://example.com/recipes/private/soup", robots), false);
  assert.equal(isAllowed("https://example.com/recipes/public/soup", robots), true);
  assert.equal(isAllowed("https://example.com/about", robots), true);
});
