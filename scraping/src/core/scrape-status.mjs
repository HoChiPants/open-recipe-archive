export function classifyScrapeStatus({ newCandidates, requested, discovery }) {
  const discoveryProblems = (discovery.failedPages || 0) + (discovery.blockedPages || 0);
  const reachedEnd = discovery.sourceQueueExhausted && newCandidates < requested;

  if (reachedEnd && discoveryProblems === 0) return "exhausted";
  if (reachedEnd && discoveryProblems > 0) return "incomplete";
  return "more";
}

export function scrapeStatusMessage(siteId, status) {
  if (status.state === "exhausted" && status.newCandidates === 0) {
    return `ALERT: ${siteId} has no new recipe URLs. All configured sitemap and pagination sources were exhausted.`;
  }
  if (status.state === "exhausted") {
    return `ALERT: ${siteId} reached the end of its configured sitemap and pagination sources. No additional URLs were found beyond this final batch (${status.newCandidates} URL(s)).`;
  }
  if (status.state === "incomplete") {
    const problems = status.failedPages + status.blockedPages;
    return `ALERT: ${siteId} found fewer than ${status.requested} new recipe URLs, but ${problems} discovery page(s) failed or were blocked, so exhaustion could not be confirmed.`;
  }
  return `${siteId} found a full batch; more recipe URLs may remain.`;
}
