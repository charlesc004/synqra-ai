import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
test("invalid model citations cannot become completed sourced answers", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/chat");
  await page
    .getByRole("textbox", { name: "Message SYNQRA" })
    .fill("fixture:invalid-citation remote work policy");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.locator(".chat-compose-wrap").getByRole("alert"),
  ).toContainText("unsupported citation");
  await expect(page.locator(".message-sources")).toHaveCount(0);
  await expect(page.locator(".message-assistant")).toContainText("failed");
});
test("provider failure leaves an honest error and allows a new request", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/chat");
  await page
    .getByRole("textbox", { name: "Message SYNQRA" })
    .fill("fixture:provider-error remote work");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.locator(".chat-compose-wrap").getByRole("alert"),
  ).toContainText("Generation failed");
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeVisible();
});
test("chat cancellation records a provisional answer rather than completion", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/chat");
  await page
    .getByRole("textbox", { name: "Message SYNQRA" })
    .fill("fixture:slow remote work policy");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-assistant .markdown")).toContainText(
    "Controlled",
  );
  await page.getByRole("button", { name: "Stop generation" }).click();
  await expect(
    page.locator(".chat-compose-wrap").getByRole("alert"),
  ).toContainText("Generation stopped");
  await expect(page.locator(".message-assistant")).toContainText("interrupted");
  await expect(page.locator(".message-sources")).toHaveCount(0);
});
test("rejecting an agent proposal creates no action", async ({ page }) => {
  await signIn(page);
  await page.goto("/agents");
  await page
    .locator(".workflow-picker")
    .getByRole("button", { name: /Turn insight into action/ })
    .click();
  await page
    .getByLabel("What would you like to accomplish?")
    .fill("Propose a security policy review for rejection testing");
  await page.getByLabel("it-security-policy.md", { exact: true }).check();
  await page.getByRole("button", { name: "Run workflow" }).click();
  await page.getByRole("button", { name: "Review proposed action" }).click();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".run-detail")).toContainText("rejected");
});
test("summary and structured extraction show real authorized source links", async ({
  page,
}) => {
  test.setTimeout(90000);
  await signIn(page);
  await page.goto("/agents");
  await page
    .locator(".workflow-picker")
    .getByRole("button", { name: /Find the bigger picture/ })
    .click();
  await page
    .getByLabel("What would you like to accomplish?")
    .fill("Summarize this remote-work document");
  await page.getByLabel("remote-work-policy.md", { exact: true }).check();
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.locator(".run-detail .source-citation")).toHaveCount(1);
  await page
    .locator(".workflow-picker")
    .getByRole("button", { name: /Extract key information/ })
    .click();
  await page
    .getByLabel("What would you like to accomplish?")
    .fill("Extract documented obligations and organization");
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.locator(".workflow-result")).toContainText(
    "Northstar Digital Operations",
  );
  await expect(page.locator(".run-detail .source-citation")).toHaveCount(1);
});
test("research workflow makes a bounded model tool call and returns cited evidence", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/agents");
  await page
    .getByLabel("What would you like to accomplish?")
    .fill("What is the remote-work policy?");
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.locator(".workflow-result")).toContainText(
    "Controlled test answer",
  );
  await expect(page.locator(".run-detail .source-citation")).toHaveCount(1);
  await expect(
    page
      .locator(".run-detail .tool-call-card")
      .filter({ hasText: "search knowledge" }),
  ).toBeVisible();
});
test("a transient embedding failure is retried by the real worker until ready", async ({
  page,
}) => {
  test.setTimeout(90000);
  await signIn(page);
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "Upload documents" }).click();
  const filename = `retry-${Date.now()}.md`;
  await page.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: "text/markdown",
    buffer: Buffer.from(
      `# Transient embedding\nfixture:embedding-retry ${filename}\nThis document should be automatically retried and indexed.`,
    ),
  });
  await expect(page.getByText("Uploaded · indexing queued")).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: filename });
  await expect(row.getByText("retrying", { exact: true })).toBeVisible();
  await expect(row.getByText("ready", { exact: true })).toBeVisible({
    timeout: 60000,
  });
});
test("mobile navigation works and the dashboard does not overflow", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await signIn(page);
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Expand sidebar", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace Settings", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("settings-collapsed-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  await expect(page.getByLabel("Select workspace")).toBeVisible();
  for (const route of [
    "dashboard",
    "chat",
    "knowledge",
    "agents",
    "actions",
    "evaluations",
    "settings",
  ]) {
    await page.goto(`/${route}`);
    await expect(page.locator(".page-content h1").first()).toBeVisible();
    await expect(page.locator(".skeleton")).toHaveCount(0);
    if (route === "chat") {
      await expect(
        page.getByRole("button", { name: "Send message" }),
      ).toBeInViewport();
    }
    if (route === "evaluations") {
      await expect(
        page.locator(".usage-chart .recharts-surface"),
      ).toBeVisible();
    }
    await page.screenshot({
      path: testInfo.outputPath(`${route}-desktop.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.locator(".stats-grid")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("dashboard-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Knowledge Base", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Knowledge Base", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".sidebar.sidebar-open")).toHaveCount(0);
  for (const route of [
    "chat",
    "knowledge",
    "agents",
    "actions",
    "evaluations",
    "settings",
  ]) {
    await page.goto(`/${route}`);
    await expect(page.locator(".page-content h1").first()).toBeVisible();
    await expect(page.locator(".skeleton")).toHaveCount(0);
    if (route === "chat") {
      await expect(
        page.getByRole("button", { name: "Send message" }),
      ).toBeInViewport();
    }
    if (route === "evaluations") {
      await expect(
        page.locator(".usage-chart .recharts-surface"),
      ).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`${route}-mobile.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator(".sidebar")).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, 0, 0)",
  );
  await page.screenshot({
    path: testInfo.outputPath("navigation-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close navigation" }).click();
  await page.goto("/login");
  await expect(page.getByLabel("Email address")).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("login-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath("login-desktop.png"),
    fullPage: true,
  });
  await page.goto("/register");
  await expect(page.getByLabel("Full name")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("register-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.getByLabel("Full name")).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("register-mobile.png"),
    fullPage: true,
  });
});
