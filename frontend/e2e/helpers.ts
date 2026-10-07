import { expect, type Page } from "@playwright/test";

export async function registerAccount(
  page: Page,
  opts: { first: string; last: string; designation?: string; email?: string },
) {
  const email = opts.email || `e2e.${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("First name").fill(opts.first);
  await page.getByLabel("Last name").fill(opts.last);
  await page.getByLabel("Designation").selectOption(opts.designation || "analyst");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (8+ characters)").fill("password1");
  await page.getByLabel("Confirm password").fill("password1");
  await page.getByRole("button", { name: "Create account" }).click();
  // A new account is greeted, then lands on Home; most specs then want the desk chooser's links.
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
  await page.goto("/choose");
  await expect(page.getByRole("heading", { name: "Choose a desk" })).toBeVisible({ timeout: 30_000 });
  return email;
}

export async function skipFirstRunTour(page: Page) {
  const skip = page.getByRole("button", { name: "Skip tour" });
  await expect(skip).toBeVisible({ timeout: 15_000 });
  await skip.click();
  await expect(skip).toHaveCount(0);
}
