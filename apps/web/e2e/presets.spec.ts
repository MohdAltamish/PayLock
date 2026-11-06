import { expect, test } from "@playwright/test";
// Relative import of the dependency-free source file: the same strings the API eval hashes.
import { DEMO_PRESETS } from "../../../packages/schemas/src/demo";

/**
 * Replay fixture hashes depend on the exact preset request text, so the chips
 * must send DEMO_PRESETS[].request unchanged: no trim, reformat or truncation.
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("login-Demo-Buyer").click();
  await expect(page.getByTestId("signed-in-as")).toHaveText("Demo Buyer");
  await page.goto("/deals/new");
});

test("every preset chip fills the exact request text", async ({ page }) => {
  for (const preset of DEMO_PRESETS) {
    await page.getByTestId(`preset-${preset.key}`).click();
    await expect(page.getByTestId("request")).toHaveValue(preset.request);
  }
});

test("creating a deal from a preset posts the exact request text", async ({ page }) => {
  const preset = DEMO_PRESETS.find((p) => p.key === "happy")!;
  await page.getByTestId(`preset-${preset.key}`).click();
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith("/api/deals") && r.method() === "POST"),
    page.getByTestId("create-deal").click(),
  ]);
  const body = req.postDataJSON() as { request: string; sellerId: string };
  expect(body.request).toBe(preset.request);
  expect(body.sellerId).toBeTruthy();
  await page.waitForURL(/\/deals\/c[a-z0-9]+$/);
});
