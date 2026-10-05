import { expect, test } from "@playwright/test";
import { registerAccount } from "./helpers";

test("chart-first terminal: studies, ticket, paper trade, history, reset", async ({ page }) => {
  await registerAccount(page, { first: "Desk", last: "Trader" });
  await page.getByRole("link", { name: "Open paper trading" }).click();
  await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Connect home" })).toBeVisible();
  await expect(page.getByRole("link", { name: "DCF" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "NIFTY 50" })).toBeVisible();
  await expect(page.getByLabel("Pinned indices").getByText("NIFTY 50", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Pinned indices").getByText("BANKNIFTY", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Position mix" })).toBeVisible();
  await expect(page.getByText(/LIVE · 20s|SIMULATED/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Symbol", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Last", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Chg", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Chg%" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove from watchlist" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Paper balances")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Chart" })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Chart" }).getByRole("button", { name: "Timeframe" })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Chart" }).getByRole("button", { name: "Compare" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Learning mode" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Learning mode" }).click();
  await expect(page.getByRole("status")).toContainText("Learning mode");
  await page.getByRole("button", { name: "Learning mode" }).click();
  await expect(page.getByRole("button", { name: "Learning mode" })).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "Timeframe" }).click();
  await page.getByRole("button", { name: "15m", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Timeframe" })).toContainText("15m");

  await page.getByRole("button", { name: "Indicators" }).click();
  await page.getByRole("dialog", { name: "Indicators" }).getByRole("button", { name: "EMA", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "EMA 20", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Indicators" }).click();
  await page.getByRole("dialog", { name: "Indicators" }).getByRole("button", { name: "EMA", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "EMA 50", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Indicators" }).click();
  await page.getByRole("dialog", { name: "Indicators" }).getByRole("button", { name: "RSI", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "RSI", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Settings RSI" }).click();
  await expect(page.getByRole("dialog", { name: "RSI settings" })).toBeVisible();
  await page.getByRole("dialog", { name: "RSI settings" }).getByLabel("length").fill("10");
  await page.getByRole("button", { name: "Apply" }).click();

  await page.getByRole("button", { name: "Hide EMA 20" }).click();
  await page.getByRole("button", { name: "Delete EMA 20" }).click();
  await expect(page.getByRole("button", { name: "EMA 20", exact: true })).toHaveCount(0);

  const canvas = page.locator("canvas.term-chart-canvas");
  const box = await canvas.boundingBox();
  if (box) {
    await page.getByRole("button", { name: "Trend" }).click();
    await page.getByRole("menuitem", { name: "Trend line" }).click();
    await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.6 } });
    await canvas.click({ position: { x: box.width * 0.6, y: box.height * 0.35 } });
    await page.getByRole("toolbar", { name: "Drawing actions" }).getByRole("button", { name: "Delete" }).click();

    await page.getByRole("button", { name: "Fibonacci" }).click();
    await page.getByRole("menuitem", { name: "Retracement" }).click();
    await canvas.click({ position: { x: box.width * 0.25, y: box.height * 0.7 } });
    await canvas.click({ position: { x: box.width * 0.55, y: box.height * 0.3 } });
    await page.getByRole("toolbar", { name: "Drawing actions" }).getByRole("button", { name: "Delete" }).click();
  }

  await page.getByRole("tab", { name: "Watchlist" }).click();
  await page.locator('.wl-row[data-symbol="BANKNIFTY"]').click();
  await expect(page.getByRole("heading", { name: "BANK NIFTY" })).toBeVisible();
  await expect(page.locator(".term-chart-wrap")).toHaveAttribute("data-chart-ready", "true");
  await page.locator('.wl-row[data-symbol="RELIANCE"]').click();
  await expect(page.getByRole("heading", { name: "Reliance Industries" })).toBeVisible();
  await expect(page.getByLabel("Pinned indices").getByText("NIFTY 50", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Pinned indices").getByText("BANKNIFTY", { exact: true })).toBeVisible();
  await expect(page.locator(".term-chart-wrap")).toHaveAttribute("data-chart-ready", "true");
  await expect(page.locator(".term-chart-wrap")).not.toHaveAttribute("data-future-bars", "0");
  const switched = page.locator("canvas.term-chart-canvas");
  const switchedBox = await switched.boundingBox();
  if (switchedBox) {
    await switched.hover({ position: { x: switchedBox.width * 0.55, y: switchedBox.height * 0.45 } });
    await switched.click({ position: { x: switchedBox.width * 0.55, y: switchedBox.height * 0.45 } });
  }
  await page.locator('.wl-row[data-symbol="NIFTY"]').click();
  await expect(page.getByRole("heading", { name: "NIFTY 50" })).toBeVisible();

  await page.getByRole("button", { name: "Search symbol" }).click();
  await expect(page.getByRole("dialog", { name: "Search symbol" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Search symbol" }).getByText(/NSE stocks loaded/)).toBeVisible({ timeout: 45_000 });
  await page.getByRole("tab", { name: "Smallcap 250" }).click();
  await expect(page.getByRole("dialog", { name: "Search symbol" }).getByText(/STOCKS · 2/)).toBeVisible();
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByLabel("Search stocks, indices, ETFs").fill("JKPAPER");
  await page.getByRole("button", { name: /JKPAPER/ }).first().click();
  await expect(page.getByRole("heading", { name: /JKPAPER|JK Paper/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".term-chart-wrap")).toHaveAttribute("data-chart-ready", "true");
  await page.locator('.wl-row[data-symbol="NIFTY"]').click();
  await expect(page.getByRole("heading", { name: "NIFTY 50" })).toBeVisible();

  await page.getByRole("tab", { name: "Trade" }).click();
  await page.getByRole("button", { name: "BUY", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Trade" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Order type")).toHaveCount(0);
  await expect(page.getByLabel("Limit price")).toHaveCount(0);
  await page.getByLabel("Quantity").fill("25");
  await page.getByLabel("Stop loss").fill("22000");
  await page.getByLabel("Take profit").fill("25000");
  await page.getByRole("button", { name: "PLACE BUY ORDER" }).click();
  await expect(page.getByRole("dialog", { name: "Order summary" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm order" }).click();
  await expect(page.getByText(/ORDER PLACED/)).toBeVisible();

  await page.getByRole("button", { name: /Positions/ }).click();
  await expect(page.getByRole("cell", { name: "NIFTY 50" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Close position" })).toBeVisible();
  await page.getByRole("button", { name: "Close position" }).click();

  await expect(page.getByRole("button", { name: "Journal" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Trade journal note")).toBeVisible();
  await page.getByLabel("Trade journal note").fill("Closed after the fill — paper size from cash.");
  await page.locator(".blot-bar").getByRole("button", { name: "Portfolio" }).click();
  await expect(page.locator(".blot-port").getByText("Cash")).toBeVisible();

  await page.getByRole("button", { name: "Trade history" }).click();
  await expect(page.getByRole("cell", { name: "NIFTY" })).toBeVisible();

  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.getByRole("region", { name: "Replay mode" })).toBeVisible();
  await page.getByRole("tab", { name: "Trade" }).click();
  await page.getByRole("button", { name: "PLACE BUY ORDER" }).click();
  await page.getByRole("button", { name: "Confirm order" }).click();

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("button", { name: "Reset paper account" }).click();
  await page.getByRole("button", { name: "Reset everything" }).click();
  await expect(page.getByText("Paper account reset.")).toBeVisible();
});
