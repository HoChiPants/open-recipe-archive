import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL(
  "../.github/workflows/publish-dailydine-feed.yml",
  import.meta.url,
);

test("Daily Dine notification skips successfully without a dispatch token", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const notification = workflow.slice(
    workflow.indexOf("      - name: Notify Daily Dine"),
  );
  const conditionals = workflow
    .split("\n")
    .filter((line) => line.trimStart().startsWith("if:"));

  assert.ok(notification.length > 0, "workflow defines the notification step");
  assert.doesNotMatch(
    conditionals.join("\n"),
    /\bsecrets\./,
    "GitHub Actions conditionals must not reference secrets directly",
  );
  assert.match(
    notification,
    /if \[ -z "\$GH_TOKEN" \]; then\n\s+echo ".*nightly reconciliation.*"\n\s+exit 0\n\s+fi/,
    "an absent token exits successfully before attempting the dispatch",
  );
  assert.match(
    notification,
    /gh api --method POST repos\/HoChiPants\/meal-manager\/dispatches/,
  );
});

test("Daily Dine publication verifies the resulting release is immutable", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const publication = workflow.slice(
    workflow.indexOf("      - name: Create immutable release"),
    workflow.indexOf("      - name: Notify Daily Dine"),
  );

  assert.match(
    publication,
    /immutable="\$\(gh release view "\$tag" --json isImmutable --jq '\.isImmutable'\)"/,
  );
  assert.match(
    publication,
    /if \[ "\$immutable" != "true" \]; then\n\s+echo "Daily Dine feed release is not immutable\." >&2\n\s+exit 1\n\s+fi/,
  );
});
