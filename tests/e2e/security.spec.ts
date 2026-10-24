import { expect, test } from "@playwright/test";

test("production CSP rotates nonces and blocks unauthorized scripts, eval and styles", async ({ page }) => {
  const response = await page.goto("/login");
  const policy = response!.headers()["content-security-policy"];
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy.split(";").find((part) => part.trim().startsWith("script-src "))).not.toContain("'unsafe-inline'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'none'");
  expect(response!.headers()["cache-control"]).toContain("no-store");
  const nonce = policy.match(/'nonce-([^']+)'/)![1];
  expect(Buffer.from(nonce, "base64").length).toBe(32);
  const scriptNonces = await page.locator("script").evaluateAll((scripts) => scripts.map((script) => script.nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(scriptNonces.every((value) => value === nonce)).toBe(true);

  await page.addInitScript(() => {
    const probe = window as unknown as { blocked: string[] };
    probe.blocked = [];
    document.addEventListener("securitypolicyviolation", (event) => probe.blocked.push(event.effectiveDirective));
  });
  // Inject into the HTTP document, so the HTML parser enforces CSP. DevTools'
  // page.evaluate has privileged script execution and cannot simulate an XSS payload.
  await page.route("**/login", async (route) => {
    const response = await route.fetch();
    const requestNonce = response.headers()["content-security-policy"].match(/'nonce-([^']+)'/)![1];
    const probes = `<script>window.unauthorized = true</script>
      <script nonce="${requestNonce}">window.authorized = true; try { new Function("return 1")(); window.evalBlocked = false; } catch { window.evalBlocked = true; }</script>
      <style>body { --unauthorized-style: injected; }</style>`;
    await route.fulfill({ response, body: (await response.text()).replace("</head>", `${probes}</head>`) });
  });
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { blocked: string[] }).blocked.length >= 3);
  const result = await page.evaluate(() => {
    const probe = window as unknown as { unauthorized?: boolean; evalBlocked?: boolean; authorized?: boolean; blocked: string[] };
    return {
      unauthorized: !!probe.unauthorized,
      authorized: probe.authorized,
      evalBlocked: probe.evalBlocked,
      injectedStyle: getComputedStyle(document.body).getPropertyValue("--unauthorized-style"),
      blocked: probe.blocked,
    };
  });
  expect(result.unauthorized).toBe(false);
  expect(result.authorized).toBe(true);
  expect(result.evalBlocked).toBe(true);
  expect(result.injectedStyle).toBe("");
  expect(result.blocked).toEqual(expect.arrayContaining(["script-src-elem", "script-src", "style-src-elem"]));

  const next = await page.request.get("/login", { headers: { "x-nonce": "attacker-supplied" } });
  const nextPolicy = next.headers()["content-security-policy"];
  expect(nextPolicy.match(/'nonce-([^']+)'/)![1]).not.toBe(nonce);
  expect(nextPolicy).not.toContain("attacker-supplied");
});
