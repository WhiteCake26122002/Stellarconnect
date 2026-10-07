import { expect, test } from "@playwright/test";
import { registerAccount } from "./helpers";

// Pages that scroll sideways on a phone, or headers that push their last button off the screen.
test("no page scrolls sideways on a phone, and the header keeps its account button on screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await registerAccount(page, { first: "Phone", last: "Fit" });
  for (const path of ["/models", "/models/new", "/funds", "/choose"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(scroll, `${path} scrolls sideways`).toBeLessThanOrEqual(inner + 1);
  }
  await page.goto("/models");
  const avatar = page.locator(".masthead .avatar").first();
  await expect(avatar).toBeVisible();
  const box = (await avatar.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});
