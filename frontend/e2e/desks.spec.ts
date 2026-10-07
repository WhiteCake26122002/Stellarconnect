import { expect, test } from "@playwright/test";
import { registerAccount } from "./helpers";

// Every desk opens with the same header as Home: a numbered kicker, an outlined echo line over the real h1, and a rule.

test("each desk opens with the shared header, and Choose a desk offers the three rooms", async ({ page }) => {
  await registerAccount(page, { first: "Desk", last: "Header" });

  // Choose a desk: the h1 is the page's heading, the echo above it is decoration only.
  await expect(page.locator(".dk-hero .dk-title")).toHaveText("Choose a desk");
  await expect(page.locator(".dk-hero .dk-echo")).toHaveAttribute("aria-hidden", "true");
  const rooms = page.locator(".cn-room");
  await expect(rooms).toHaveCount(3);
  const box = (await rooms.nth(0).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 60);
  await expect(rooms.nth(0)).toHaveClass(/hot/);
  await rooms.nth(2).click();
  await expect(page).toHaveURL(/\/funds/);

  // Mutual funds
  await expect(page.getByRole("heading", { level: 1, name: "Mutual funds" })).toBeVisible();
  await expect(page.locator(".dk-hero .dk-kick")).toContainText("Holdings");

  // Models: an empty desk shows the dashed frame, and New model is numbered step by step.
  await page.goto("/models");
  await expect(page.getByRole("heading", { level: 1, name: "Models", exact: true })).toBeVisible();
  await expect(page.locator(".dk-empty")).toBeVisible();
  await page.getByRole("link", { name: "Create your first model" }).click();
  await expect(page).toHaveURL(/\/models\/new/);
  await expect(page.getByRole("heading", { name: /Live company/ })).toContainText("01");
  await expect(page.getByRole("heading", { name: /Sample/ }).first()).toContainText("02");

  // Paper trading: the Overview opens with the same header.
  await page.goto("/terminal");
  await page.getByRole("button", { name: /Overview/i }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Paper trading" })).toBeVisible();
  await expect(page.locator(".dk-hero .dk-stats")).toContainText("₹10,00,000");
});

test("on a phone the desk headers fit with no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await registerAccount(page, { first: "Desk", last: "Phone" });
  for (const path of ["/choose", "/models", "/models/new", "/funds"]) {
    await page.goto(path);
    await expect(page.locator(".dk-hero")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
});

test("the model list can be sorted and shows an upside bar", async ({ page }) => {
  await registerAccount(page, { first: "Desk", last: "Sorter" });
  await page.goto("/models/new");
  await page.getByRole("button", { name: "Open sample model" }).click();
  await page.waitForURL(/\/models\/[^/]+$/, { timeout: 60_000 });
  await page.goto("/models");
  await expect(page.locator(".dk-list a.row")).toHaveCount(1);
  await expect(page.locator(".dk-list .dk-bar")).toHaveCount(1);
  await expect(page.locator(".dk-hero .dk-stats")).toContainText("Implied above price");
  const upside = page.getByRole("button", { name: "Upside", exact: true });
  await upside.click();
  await expect(upside).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Recent", exact: true })).toHaveAttribute("aria-pressed", "false");
});
