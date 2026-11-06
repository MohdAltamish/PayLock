import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * axe accessibility audit on key pages.
 * Reports serious and critical violations only.
 */

test("landing page accessibility", async ({ page }) => {
  await page.goto("/");
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  
  const serious = accessibilityScanResults.violations.filter(v => v.impact === "serious" || v.impact === "critical");
  console.log(`Landing: ${serious.length} serious/critical violations`);
  serious.forEach(v => console.log(`  - ${v.id}: ${v.description}`));
  
  expect(serious).toHaveLength(0);
});

test("create wizard accessibility", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("login-Demo-Buyer").click();
  await page.goto("/deals/new");
  
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  
  const serious = accessibilityScanResults.violations.filter(v => v.impact === "serious" || v.impact === "critical");
  console.log(`Create wizard: ${serious.length} serious/critical violations`);
  serious.forEach(v => console.log(`  - ${v.id}: ${v.description}`));
  
  expect(serious).toHaveLength(0);
});

test("deal detail accessibility", async ({ page }) => {
  // Create a deal first
  await page.goto("/");
  await page.getByTestId("login-Demo-Buyer").click();
  await page.goto("/deals/new");
  await page.getByTestId("preset-happy").click();
  await page.getByTestId("create-deal").click();
  await page.waitForURL(/\/deals\/c[a-z0-9]+$/);
  
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  
  const serious = accessibilityScanResults.violations.filter(v => v.impact === "serious" || v.impact === "critical");
  console.log(`Deal detail: ${serious.length} serious/critical violations`);
  serious.forEach(v => console.log(`  - ${v.id}: ${v.description}`));
  
  expect(serious).toHaveLength(0);
});
