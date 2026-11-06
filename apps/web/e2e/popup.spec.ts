import { expect, test } from "@playwright/test";

/**
 * npm run e2e:popup -w @paylock/web: the real v6 buyer popup, headed. The
 * person running it logs in with the sandbox buyer account in the popup
 * (credentials are never stored here). Flaky by nature; not part of CI.
 */
test("happy path through the real PayPal popup", async ({ page, context }) => {
  test.setTimeout(600_000);
  await page.goto("/");
  await page.getByTestId("login-Demo-Buyer").click();
  await page.goto("/deals/new");
  await page.getByTestId("preset-happy").click();
  await page.getByTestId("create-deal").click();
  await page.waitForURL(/\/deals\/c[a-z0-9]+$/);
  await page.getByTestId("run-guard").click();
  await expect(page.getByTestId("risk-banner")).toContainText("Risk: Low");
  const popup = context.waitForEvent("page");
  await page.getByTestId("paypal-button").click();
  await (await popup).waitForLoadState();
  // Log in as the sandbox buyer and approve in the popup by hand.
  await expect(page.getByTestId("money-state")).toHaveText(/Funds reserved/, { timeout: 540_000 });
});
