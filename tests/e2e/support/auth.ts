import { expect, type BrowserContext, type Page } from "@playwright/test";

// Each context stays isolated; reuse a verified cookie session to avoid exhausting
// the production login limit when many browser scenarios run on one CI worker.
const sessions = new Map<
  string,
  Awaited<ReturnType<BrowserContext["cookies"]>>
>();

export async function signIn(page: Page, email = "alex@northstar.example") {
  const cookies = sessions.get(email);
  if (cookies) {
    await page.context().addCookies(cookies);
    if ((await page.request.get("/api/v1/auth/me")).ok()) {
      await page.goto("/dashboard");
      await expect(page.locator(".page-content h1")).toBeVisible();
      return;
    }
    sessions.delete(email);
    await page.context().clearCookies();
  }
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.SEED_PASSWORD || "ci-fixture-password-2026");
  await page.getByRole("button", { name: "Sign in to your workspace" }).click();
  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ }),
  ).toBeVisible();
  sessions.set(email, await page.context().cookies());
}
