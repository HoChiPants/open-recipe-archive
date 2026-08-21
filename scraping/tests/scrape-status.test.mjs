import assert from "node:assert/strict";
import test from "node:test";
import { classifyScrapeStatus, scrapeStatusMessage } from "../src/core/scrape-status.mjs";

const completeDiscovery = {
  blockedPages: 0,
  failedPages: 0,
  sourceQueueExhausted: true
};

test("reports exhausted when traversal ends before filling the batch", () => {
  assert.equal(classifyScrapeStatus({
    newCandidates: 0,
    requested: 250,
    discovery: completeDiscovery
  }), "exhausted");
  assert.equal(classifyScrapeStatus({
    newCandidates: 37,
    requested: 250,
    discovery: completeDiscovery
  }), "exhausted");
});

test("does not claim exhaustion when discovery had gaps", () => {
  assert.equal(classifyScrapeStatus({
    newCandidates: 0,
    requested: 250,
    discovery: { ...completeDiscovery, failedPages: 1 }
  }), "incomplete");
  assert.match(scrapeStatusMessage("example", {
    state: "incomplete",
    newCandidates: 0,
    requested: 250,
    failedPages: 1,
    blockedPages: 0
  }), /could not be confirmed/);
});

test("reports that more may remain after filling the requested batch", () => {
  assert.equal(classifyScrapeStatus({
    newCandidates: 250,
    requested: 250,
    discovery: { ...completeDiscovery, sourceQueueExhausted: false }
  }), "more");
});
