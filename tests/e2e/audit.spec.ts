import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { signIn } from "./support/auth";
import type { AxeResults } from "axe-core";
const require = createRequire(`${process.cwd()}/package.json`);

test("responsive accessibility audit of workspace, settings tabs and dialogs", async ({
  page,
}) => {
  test.setTimeout(180000);
  const findings: {
    name: string;
    violations: AxeResults["violations"];
    incomplete: AxeResults["incomplete"];
  }[] = [];
  const failures: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`Unexpected CSP violation: ${event.effectiveDirective}`);
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().startsWith("Unexpected CSP violation:")) {
      errors.push(message.text());
    }
  });
  await signIn(page);
  // Fresh CI databases have no measured usage yet. Create it through the real
  // fixture-backed chat path before asserting that the usage chart is rendered.
  await page.goto("/knowledge");
  await page.getByRole("textbox", { name: "Find a document by name…" }).fill("remote-work-policy.md");
  await expect(
    page.getByRole("row").filter({ hasText: "remote-work-policy.md" }).getByText("ready", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page.goto("/chat");
  await page.getByRole("textbox", { name: "Message SYNQRA" }).fill("What is the remote-work policy?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-assistant .markdown")).toContainText("Controlled test answer");
  await expect(page.locator(".message-sources .source-citation").first()).toBeVisible();
  await mkdir("test-reports/audit", { recursive: true });
  async function inspect(name: string) {
    const source = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
    // Run the audit through DevTools, outside the application's execution policy.
    // axe compiles rule templates with Function; it must not weaken production CSP.
    await page.evaluate(source);
    const result = await page.evaluate(async () => {
      const audit = await (
        window as unknown as { axe: typeof import("axe-core") }
      ).axe.run({
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      });
      return { violations: audit.violations, incomplete: audit.incomplete };
    });
    findings.push({ name, ...result });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      failures.push(`${name}: horizontal page overflow`);
    await page.screenshot({
      path: `test-reports/audit/${name}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width >= 768 ? 900 : 844 });
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
      if (route === "evaluations")
        await expect(
          page.locator(".usage-chart .recharts-surface"),
        ).toBeVisible();
      await inspect(`${route}-${width}`);
    }
    for (const tab of ["Members", "AI & Models", "Security"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await expect(page.locator(".skeleton")).toHaveCount(0);
      await inspect(`settings-${tab.replaceAll(/[^a-z]/gi, "")}-${width}`);
    }
    await page.goto("/knowledge");
    await page
      .getByRole("button", { name: "Upload documents", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await inspect(`upload-dialog-${width}`);
    await page.getByRole("button", { name: "Close dialog" }).click();
    for (const route of ["login", "register"]) {
      await page.goto(`/${route}`);
      await expect(page.getByLabel("Email address")).toBeVisible();
      await inspect(`${route}-${width}`);
    }
  }
  await writeFile(
    "test-reports/audit/accessibility.json",
    JSON.stringify({ findings, failures, errors }, null, 2),
  );
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  const violations = findings.flatMap((entry) =>
    entry.violations.map((v) => `${entry.name}: ${v.id} (${v.impact})`),
  );
  expect(violations).toEqual([]);
});
