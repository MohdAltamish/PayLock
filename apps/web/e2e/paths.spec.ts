import { expect, test, type Page } from "@playwright/test";

/**
 * The three demo paths against the PayPal sandbox (card funding, no popup).
 * happy: Low risk -> reserve -> deliver pass -> Funds released
 * scam:  High risk -> Do not fund -> Cancelled, nothing reserved
 * fail:  Low risk -> reserve -> deliver bad -> Funds returned
 */
async function signIn(page: Page, name: string) {
  await page.goto("/");
  await page.getByTestId(`login-${name.replaceAll(" ", "-")}`).click();
  await expect(page.getByTestId("signed-in-as")).toHaveText(name);
}

async function createDeal(page: Page, preset: string) {
  await signIn(page, "Demo Buyer");
  await page.goto("/deals/new");
  await page.getByTestId(`preset-${preset}`).click();
  await page.getByTestId("create-deal").click();
  await page.waitForURL(/\/deals\/c[a-z0-9]+$/);
  await expect(page.getByTestId("deal-state")).toHaveText("Contract ready");
  return page.url();
}

async function reserve(page: Page) {
  await page.getByTestId("run-guard").click();
  await expect(page.getByTestId("risk-banner")).toContainText("Risk: Low");
  await page.getByTestId("fund-test-card").click();
  await expect(page.getByTestId("money-state")).toHaveText(/Funds reserved/, { timeout: 60_000 });
}

async function deliverAsSeller(page: Page, url: string, seller: string) {
  await signIn(page, seller);
  await page.goto(url);
  await page.getByTestId("use-demo-deliverable").click();
  await page.getByTestId("submit-deliverable").click();
}

test("happy path: verified work releases the funds", async ({ page }) => {
  const url = await createDeal(page, "happy");
  await reserve(page);
  await deliverAsSeller(page, url, "Honest Seller");
  await expect(page.getByTestId("decision-panel")).toContainText("PASS", { timeout: 90_000 });
  await expect(page.getByTestId("money-state")).toHaveText(/Funds released/, { timeout: 120_000 });
  await expect(page.getByTestId("deal-state")).toHaveText("Released");
  await expect(page.getByTestId("timeline")).toContainText("PayPal captured the payment");
});

test("scam path: high risk signals block funding", async ({ page }) => {
  await createDeal(page, "scam");
  await page.getByTestId("run-guard").click();
  const banner = page.getByTestId("risk-banner");
  await expect(banner).toContainText("Risk: High");
  await expect(banner).toContainText("Recommended: do not fund");
  await expect(banner).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("fund-test-card")).toHaveCount(0);
  await page.getByTestId("do-not-fund").click();
  await expect(page.getByTestId("deal-state")).toHaveText("Cancelled");
  await expect(page.getByTestId("money-state")).toHaveText(/Not reserved/);
});

test("fail path: work that misses the contract returns the funds", async ({ page }) => {
  const url = await createDeal(page, "fail");
  await reserve(page);
  await deliverAsSeller(page, url, "Rushed Delivery Seller");
  await expect(page.getByTestId("decision-panel")).toContainText("FAIL", { timeout: 90_000 });
  await expect(page.getByTestId("money-state")).toHaveText(/Funds returned/, { timeout: 60_000 });
  await expect(page.getByTestId("block-reason")).toHaveText("The work did not meet the contract");
});
