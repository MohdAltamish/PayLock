import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * axe accessibility audit on every page, after its content has rendered.
 * Reports serious and critical violations only.
 */
async function audit(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  console.log(`${name}: ${serious.length} serious/critical violations`);
  serious.forEach((v) =>
    console.log(`  - ${v.id}: ${v.description} (${v.nodes.map((n) => n.target).join(", ")})`),
  );
  expect(serious).toHaveLength(0);
}

async function signInAsBuyer(page: Page) {
  await page.goto("/");
  await page.getByTestId("login-Demo-Buyer").click();
  await expect(page.getByTestId("signed-in-as")).toHaveText("Demo Buyer");
}

test("landing page accessibility", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("login-Demo-Buyer").waitFor();
  await audit(page, "Landing");
});

test("create wizard accessibility", async ({ page }) => {
  await signInAsBuyer(page);
  await page.goto("/deals/new");
  await page.getByTestId("preset-happy").waitFor();
  await audit(page, "Create wizard");
});

test("deal list accessibility", async ({ page }) => {
  await signInAsBuyer(page);
  await page.goto("/deals");
  await page.getByRole("heading", { name: "Deals" }).waitFor();
  await audit(page, "Deal list");
});

test("spend policy accessibility", async ({ page }) => {
  await signInAsBuyer(page);
  await page.goto("/settings/policy");
  await page.getByRole("heading", { name: "Spend policy" }).waitFor();
  await audit(page, "Spend policy");
});

test("deal detail accessibility", async ({ page }) => {
  await signInAsBuyer(page);
  await page.goto("/deals/new");
  await page.getByTestId("preset-happy").click();
  await page.getByTestId("create-deal").click();
  await page.waitForURL(/\/deals\/c[a-z0-9]+$/);
  await expect(page.getByTestId("deal-state")).toHaveText("Contract ready");
  await audit(page, "Deal detail");
});
