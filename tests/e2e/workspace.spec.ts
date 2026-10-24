import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
test("full knowledge, chat, approval, comparison, and evaluation workflow", async ({
  page,
}) => {
  test.setTimeout(180000);
  await signIn(page);
  await expect(page.getByLabel("Select workspace")).toContainText(
    "Northstar Digital Operations",
  );
  await page.getByRole("link", { name: "Knowledge Base", exact: true }).click();
  await page.getByRole("button", { name: "Upload documents" }).click();
  const uploadName = `e2e-remote-${Date.now()}.md`;
  await page.locator('input[type="file"]').setInputFiles({
    name: uploadName,
    mimeType: "text/markdown",
    buffer: Buffer.from(
      `# Remote work\nRemote work is allowed three days per week after manager approval.\nAudit upload: ${uploadName}`,
    ),
  });
  await expect(page.getByText("Uploaded · indexing queued")).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: uploadName });
  await expect(row.getByText("ready", { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole("button", { name: "Knowledge search" }).click();
  await page
    .getByRole("textbox", { name: "Ask your knowledge a question…" })
    .fill("remote work policy");
  await page
    .getByRole("button", { name: "Search knowledge", exact: true })
    .click();
  await expect(page.locator(".search-results article").first()).toBeVisible();
  await page.getByRole("link", { name: "AI Chat", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message SYNQRA" })
    .fill("What is the remote-work policy?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("CONNECTED SOURCES", { exact: true }),
  ).toBeVisible();
  await page.locator(".message-sources .source-citation").first().click();
  await expect(page.getByText(/CITED EXCERPT/)).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("link", { name: "What is the remote-work policy?", exact: true })
    .first()
    .click();
  await expect(page.locator(".message-assistant")).toContainText(
    "Controlled test answer",
  );
  await page
    .getByRole("link", { name: "Agents", exact: false })
    .first()
    .click();
  await page
    .locator(".workflow-picker")
    .getByRole("button", { name: /Compare documents/ })
    .click();
  await page
    .getByLabel("What would you like to accomplish?")
    .fill("Compare the policy revisions");
  await page.getByLabel("it-security-policy.md", { exact: true }).check();
  await page
    .getByLabel("it-security-policy-revised.md", { exact: true })
    .check();
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.locator(".workflow-result")).toContainText(
    "Controlled fixture comparison",
  );
  await page
    .locator(".workflow-picker")
    .getByRole("button", { name: /Turn insight into action/ })
    .click();
  await page
    .getByLabel("What would you like to accomplish?")
    .fill("Propose a review of the security policy");
  await page.getByRole("button", { name: "Run workflow" }).click();
  await page.getByRole("button", { name: "Review proposed action" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Review the security policy",
  );
  await page
    .getByRole("button", { name: "Approve action", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("link", { name: "Action Items", exact: true }).click();
  await expect(
    page
      .getByRole("heading", {
        name: "Review the security policy",
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Evaluations", exact: true }).click();
  await page.getByRole("button", { name: "New evaluation" }).click();
  const benchmarkName = `Workflow benchmark ${Date.now()}`;
  await page.getByLabel("Benchmark name").fill(benchmarkName);
  await page
    .getByLabel("Question", { exact: true })
    .fill("What is the remote-work policy?");
  await page.getByLabel("remote-work-policy.md", { exact: true }).check();
  await page.getByRole("button", { name: /Add question/ }).click();
  await page
    .getByRole("button", { name: "Run evaluation", exact: true })
    .click();
  const evaluationRow = page.getByRole("row").filter({ hasText: benchmarkName });
  await expect(evaluationRow.getByText("completed", { exact: true })).toBeVisible({ timeout: 60000 });
  await evaluationRow.getByRole("button", { name: "Inspect results" }).click();
  await expect(
    page.getByRole("heading", { name: "Case-by-case results" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Knowledge Base", exact: true }).click();
  await page.getByRole("button", { name: "New collection" }).click();
  const scopeName = `Empty evidence ${Date.now()}`;
  await page.getByLabel("Collection name").fill(scopeName);
  await page
    .getByRole("button", { name: "Create collection", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("link", { name: "AI Chat", exact: true }).click();
  await page.getByLabel("Knowledge scope").selectOption({ label: scopeName });
  await page
    .getByRole("textbox", { name: "Message SYNQRA" })
    .fill("A question with no evidence in this collection");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-assistant .markdown")).toContainText(
    "couldn’t find supporting evidence",
  );
  await expect(page.locator(".message-sources")).toHaveCount(0);
  await page.getByRole("button", { name: "Rename conversation" }).click();
  const renamed = `No-evidence audit ${Date.now()}`;
  await page.getByLabel("Conversation title").fill(renamed);
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await page.getByRole("link", { name: renamed, exact: true }).click();
  await expect(
    page.getByLabel("Knowledge scope").locator("option:checked"),
  ).toHaveText(scopeName);
  await expect(page.locator(".message-assistant .markdown")).toContainText(
    "couldn’t find supporting evidence",
  );
  await page.getByRole("button", { name: "Delete conversation" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: renamed, exact: true }),
  ).toHaveCount(0);
});
test("viewer cannot upload or mutate knowledge", async ({ page }) => {
  await signIn(page, "casey@northstar.example");
  await page.getByRole("link", { name: "Knowledge Base", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Upload documents" }),
  ).not.toBeVisible();
  const status = await page.evaluate(async () => {
    const token =
      document.cookie
        .split("; ")
        .find((c) => c.startsWith("synqra_csrf="))
        ?.split("=")[1] || "";
    const workspaces = (await (await fetch("/api/v1/workspaces")).json()) as {
      id: string;
    }[];
    return (
      await fetch("/api/v1/collections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
          "X-Workspace-Id": workspaces[0].id,
        },
        body: JSON.stringify({ name: "Forbidden" }),
      })
    ).status;
  });
  expect(status).toBe(403);
});
