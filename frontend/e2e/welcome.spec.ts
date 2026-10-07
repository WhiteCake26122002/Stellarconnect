import { expect, test } from "@playwright/test";

// Signing up or in plays a welcome by name and lands on Home, not on the desk chooser.
test("registering welcomes the person by name and lands on Home; signing in welcomes them back", async ({ page }) => {
  const email = `e2e.welcome.${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Lovelace");
  await page.getByLabel("Designation").selectOption("analyst");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (8+ characters)").fill("password1");
  await page.getByLabel("Confirm password").fill("password1");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.locator(".curtain-kicker")).toHaveText("Welcome", { timeout: 15_000 });
  await expect(page.locator(".curtain-name")).toHaveAttribute("aria-label", "Ada Lovelace");
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
  await expect(page.locator(".curtain")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("password1");
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await expect(page.locator(".curtain-kicker")).toHaveText("Welcome back", { timeout: 15_000 });
  await expect(page.locator(".curtain-name")).toHaveAttribute("aria-label", /Ada/);
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
});

test("each desk shows its own loader while it opens", async ({ page }) => {
  const email = `e2e.loader.${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("First name").fill("Load");
  await page.getByLabel("Last name").fill("Er");
  await page.getByLabel("Designation").selectOption("analyst");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (8+ characters)").fill("password1");
  await page.getByLabel("Confirm password").fill("password1");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
  await expect(page.locator(".curtain")).toHaveCount(0, { timeout: 15_000 });

  for (const [path, label] of [["/terminal", "Opening Paper trading"], ["/funds", "Opening Mutual funds"], ["/models", "Opening Valuation models"]] as const) {
    await page.goto(path, { waitUntil: "commit" });
    await expect(page.getByRole("status", { name: label })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("status", { name: label })).toHaveCount(0, { timeout: 30_000 });
  }
});
