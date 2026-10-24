import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";

test("galaxy login stays usable on mobile and respects reduced motion", async ({
  page,
}, testInfo) => {
  await page.goto("/login");
  await expect(page.locator(".cosmic-scene")).toBeVisible();
  await page.getByLabel("Email address").click();
  await expect(page.getByLabel("Email address")).toBeFocused();
  await expect(page.locator(".cosmic-orbit-outer")).toHaveCSS(
    "animation-name",
    "orbit-turn",
  );
  await page.screenshot({
    path: testInfo.outputPath("cosmic-login-desktop.png"),
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".cosmic-orbit-outer")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.locator(".cosmic-nebula-blue")).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Email address")).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("cosmic-login-mobile.png"),
    fullPage: true,
  });
  await page.goto("/register");
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.getByLabel("Full name")).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("cosmic-register-mobile.png"),
    fullPage: true,
  });
});

test("knowledge dropdown has contrasting options and keeps keyboard selection", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/chat");
  const scope = page.getByLabel("Knowledge scope");
  const choice = scope
    .locator("option")
    .filter({ hasText: "People & Culture" });
  await expect(choice).toHaveCount(1);
  await expect(choice).toHaveCSS("color", "rgb(243, 243, 243)");
  await expect(choice).toHaveCSS("background-color", "rgb(37, 37, 37)");
  await scope.click();
  await page.screenshot({
    path: testInfo.outputPath("knowledge-dropdown-open.png"),
    fullPage: true,
  });
  await scope.press("Escape");
  await scope.focus();
  await scope.press("ArrowDown");
  await scope.press("Enter");
  await expect(scope).not.toHaveValue("");
  await page.screenshot({
    path: testInfo.outputPath("knowledge-scope-readable.png"),
    fullPage: true,
  });
});
