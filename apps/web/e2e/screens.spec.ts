import { expect, test, type Page } from "@playwright/test";

/**
 * Before/after screenshots of every screen at 375px and 1280px.
 * Off by default. Run with:
 *   SCREENSHOTS=1 SCREENS_LABEL=before npx playwright test e2e/screens.spec.ts
 * Output: apps/web/.screens/<label>/<screen>-<width>.png (gitignored; Playwright
 * wipes test-results/ on every run, so screenshots live outside it).
 */
const LABEL = process.env.SCREENS_LABEL ?? "after";
const WIDTHS = [375, 1280] as const;

test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture screens");

async function signIn(page: Page, name: string) {
  await page.goto("/");
  await page.getByTestId(`login-${name.replaceAll(" ", "-")}`).click();
  await expect(page.getByTestId("signed-in-as")).toHaveText(name);
}

async function createDeal(page: Page, preset: string) {
  await page.goto("/deals/new");
  await page.getByTestId(`preset-${preset}`).click();
  await page.getByTestId("create-deal").click();
  await page.waitForURL(/\/deals\/c[a-z0-9]+$/);
  await expect(page.getByTestId("deal-state")).toHaveText("Contract ready");
  return page.url();
}

async function shoot(page: Page, name: string, url: string, ready?: () => Promise<void>) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto(url);
    await page.waitForLoadState("networkidle").catch(() => {});
    if (ready) await ready();
    await page.screenshot({
      path: `.screens/${LABEL}/${name}-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
}

test("capture every screen", async ({ page }) => {
  test.setTimeout(400_000);
  const dealReady = (text: string | RegExp) => async () => {
    await expect(page.getByTestId("deal-state")).toHaveText(text);
  };

  await shoot(page, "01-landing", "/", async () => {
    await page.getByTestId("login-Demo-Buyer").waitFor();
  });

  await signIn(page, "Demo Buyer");
  const contracted = await createDeal(page, "happy");

  const flagged = await createDeal(page, "scam");
  await page.getByTestId("run-guard").click();
  await expect(page.getByTestId("risk-banner")).toContainText("Risk: High");

  const released = await createDeal(page, "happy");
  await page.getByTestId("run-guard").click();
  await expect(page.getByTestId("risk-banner")).toContainText("Risk: Low");
  await page.getByTestId("fund-test-card").click();
  await expect(page.getByTestId("money-state")).toHaveText(/Funds reserved/, { timeout: 60_000 });
  await signIn(page, "Honest Seller");
  await page.goto(released);
  await page.getByTestId("use-demo-deliverable").click();
  await page.getByTestId("submit-deliverable").click();
  await expect(page.getByTestId("money-state")).toHaveText(/Funds released/, { timeout: 120_000 });
  await signIn(page, "Demo Buyer");

  await shoot(page, "02-deal-list", "/deals", async () => {
    await page.getByRole("heading", { name: "Deals" }).waitFor();
    await page
      .getByRole("link", { name: /bakery|logo|landing/i })
      .first()
      .waitFor();
  });
  await shoot(page, "03-new-deal", "/deals/new", async () => {
    await page.getByTestId("preset-happy").waitFor();
  });
  await shoot(page, "04-deal-contracted", contracted, dealReady("Contract ready"));
  await shoot(page, "05-deal-flagged", flagged, dealReady("High risk"));
  await shoot(page, "06-deal-released", released, dealReady("Released"));
  await shoot(page, "07-policy", "/settings/policy", async () => {
    await page.getByRole("heading", { name: "Spend policy" }).waitFor();
  });
});
