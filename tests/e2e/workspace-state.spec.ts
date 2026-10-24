import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";

test("workspace changes discard unsaved state and mobile navigation contains keyboard focus", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const selector = page.getByLabel("Select workspace");
  const originalId = await selector.inputValue();
  const originalName = await page
    .getByLabel("Workspace name", { exact: true })
    .inputValue();
  await page.getByLabel("Workspace name", { exact: true }).fill("");
  await expect(page.getByLabel("Workspace name", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByLabel("Workspace name", { exact: true })
    .fill("Unsaved original workspace draft");
  const name = "Audit isolation workspace";
  const existing = selector.locator("option").filter({ hasText: name });
  if (await existing.count()) {
    await selector.selectOption({ label: name });
  } else {
    await page
      .getByRole("button", { name: "New workspace", exact: true })
      .click();
    await page.getByRole("dialog").getByLabel("Workspace name").fill(name);
    await page
      .getByRole("button", { name: "Create workspace", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  await expect(page.getByLabel("Workspace name", { exact: true })).toHaveValue(
    name,
  );
  const isolatedId = await selector.inputValue();
  await page
    .getByLabel("Workspace name", { exact: true })
    .fill("Unsaved isolated workspace draft");
  await selector.selectOption(originalId);
  await expect(page.getByLabel("Workspace name", { exact: true })).toHaveValue(
    originalName,
  );
  await page.getByRole("link", { name: "AI Chat", exact: true }).click();
  await page
    .getByLabel("Message SYNQRA")
    .fill("Private unsent draft from the original workspace");
  await selector.selectOption(isolatedId);
  await expect(page.getByLabel("Message SYNQRA")).toHaveValue("");
  await page.setViewportSize({ width: 390, height: 844 });
  const open = page.getByRole("button", { name: "Open navigation" });
  await open.click();
  await expect(
    page.getByRole("dialog", { name: "Workspace navigation" }),
  ).toBeVisible();
  for (let step = 0; step < 14; step++) {
    await page.keyboard.press(step === 0 ? "Shift+Tab" : "Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest(".sidebar")),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
  await expect(page.locator(".sidebar.sidebar-open")).toHaveCount(0);
  await open.click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("button", { name: "Sign in to your workspace" }),
  ).toBeVisible();
});
