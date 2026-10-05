import { expect, test } from "@playwright/test";
import { registerAccount } from "./helpers";

test("desk views: chart stays first, heatmap and world map open", async ({ page }) => {
  await registerAccount(page, { first: "Desk", last: "Views" });
  await page.getByRole("link", { name: "Open paper trading" }).click();
  await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("navigation", { name: "Desk views" }).getByRole("button", { name: "Chart" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "NIFTY 50" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Drawing tools" })).toBeVisible();

  await page.route("**/v1/market/heatmap**", async (route) => {
    const url = new URL(route.request().url());
    const index = url.searchParams.get("index") || "";
    const small = /smallcap/i.test(index);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        index: small ? "Nifty Smallcap 250" : index || "Nifty 50",
        range: "D",
        live: true,
        tiles: small
          ? [
              { symbol: "JKPAPER", name: "JK Paper", industry: "Forest Materials", last: 412, change_pct: 0.018, market_cap: 70_000_000_000, live: true },
              { symbol: "CDSL", name: "CDSL", industry: "Financial Services", last: 1410, change_pct: -0.012, market_cap: 290_000_000_000, live: true },
            ]
          : [
              { symbol: "RELIANCE", name: "Reliance Industries", industry: "Oil Gas", last: 1226, change_pct: -0.014, market_cap: 16_600_000_000_000, live: true },
              { symbol: "TCS", name: "TCS", industry: "Information Technology", last: 2105, change_pct: -0.038, market_cap: 7_600_000_000_000, live: true },
            ],
      }),
    });
  });
  await page.getByRole("button", { name: "Heat map" }).click();
  await expect(page.getByRole("heading", { name: "Heat map" })).toBeVisible();
  await expect(page.getByLabel("Market heat map")).toBeVisible();
  await expect(page.getByLabel("Index", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Index", { exact: true }).locator("option", { hasText: "Nifty Midcap" })).toHaveCount(1);
  await expect(page.getByLabel("Index", { exact: true }).locator("option", { hasText: "Nifty Smallcap" })).toHaveCount(1);
  await expect(page.getByLabel("Time frame")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Y", exact: true })).toHaveCount(0);
  await page.getByLabel("Index", { exact: true }).selectOption("Nifty Smallcap 250");
  await expect(page.getByLabel("Market heat map").getByLabel("JKPAPER JK Paper")).toBeVisible();
  await expect(page.getByLabel("Market heat map").getByLabel("CDSL CDSL")).toBeVisible();
  await expect(page.getByLabel("Market heat map").getByLabel(/RELIANCE/)).toHaveCount(0);
  await page.getByLabel("Index", { exact: true }).selectOption("Nifty Midcap 150");
  await page.getByLabel("Index", { exact: true }).selectOption("Nifty 50");
  await page.getByLabel("Market heat map").locator("rect.heat-tile").first().click();
  await expect(page.getByRole("navigation", { name: "Desk views" }).getByRole("button", { name: "Chart" })).toHaveAttribute("aria-current", "page");

  await page.route("**/v1/market/world**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        live: true,
        count: 5,
        quotes: [
          { symbol: "NIFTY", yahoo: "^NSEI", last: 23346.4, prev_close: 23200, open: 23210, high: 23400, low: 23180, change: 146.4, change_pct: 0.0063, volume: 1, ts: 1, live: true },
          { symbol: "SPX", yahoo: "^GSPC", last: 7650.5, prev_close: 7600, open: 7610, high: 7660, low: 7590, change: 50.5, change_pct: 0.0066, volume: 1, ts: 1, live: true },
          { symbol: "N225", yahoo: "^N225", last: 65019, prev_close: 64800, open: 64810, high: 65100, low: 64700, change: 219, change_pct: 0.0034, volume: 1, ts: 1, live: true },
          { symbol: "FTSE", yahoo: "^FTSE", last: 10659, prev_close: 10600, open: 10610, high: 10680, low: 10580, change: 59, change_pct: 0.0056, volume: 1, ts: 1, live: true },
          { symbol: "TASI", yahoo: "^TASI.SR", last: 10777.94, prev_close: 10820, open: 10810, high: 10840, low: 10750, change: -42.06, change_pct: -0.0039, volume: 1, ts: 1, live: true },
        ],
      }),
    });
  });
  await page.getByRole("button", { name: "World map" }).click();
  await expect(page.getByRole("heading", { name: "World map" })).toBeVisible();
  await expect(page.getByLabel("World index map")).toBeVisible();
  const indexList = page.getByLabel("Index list");
  await expect(indexList).toBeVisible();
  await expect(indexList.getByRole("button", { name: /United States/ })).toBeVisible();
  await expect(indexList.getByRole("button", { name: /Japan/ })).toBeVisible();
  await expect(indexList.getByRole("button", { name: /Saudi Arabia/ })).toBeVisible();
  await expect(indexList.getByRole("button", { name: /India/ })).toBeVisible();
  await expect(indexList.getByRole("button", { name: /United Kingdom/ })).toBeVisible();
  await expect(indexList.getByText("7,651")).toBeVisible();
  await expect(indexList.getByText("10,778")).toBeVisible();
  await expect(page.getByLabel("World index map").locator("path.mapped")).toHaveCount(5);
  await page.getByRole("button", { name: "Open chart" }).click();
  await expect(page.getByRole("heading", { name: "NIFTY 50" })).toBeVisible();

  await page.getByRole("button", { name: "Portfolio" }).first().click();
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  await expect(page.getByLabel("Portfolio totals")).toBeVisible();
  await expect(page.getByLabel("Holdings mix")).toBeVisible();
  await expect(page.getByLabel("Holdings mix").getByRole("button", { name: /Cash/ })).toBeVisible();

  await page.getByRole("navigation", { name: "Desk views" }).getByRole("button", { name: "Chart" }).click();
  await page.locator('.wl-row[data-symbol="RELIANCE"]').click();
  await expect(page.getByRole("heading", { name: "Reliance Industries" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fetch financials" }).first()).toBeVisible();
  await page.route("**/v1/market/financials**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol: "RELIANCE",
        yahoo: "RELIANCE.NS",
        name: "Reliance Industries",
        currency: "INR",
        live: true,
        message: null,
        ratios: [
          { id: "roe", label: "ROE", value: 0.09, format: "pct" },
          { id: "roce", label: "ROCE", value: 0.11, format: "pct" },
          { id: "pe", label: "PE", value: 24.1, format: "number" },
          { id: "pb", label: "PB", value: 2.2, format: "number" },
          { id: "dividend_yield", label: "Dividend yield", value: 0.005, format: "pct" },
        ],
        income: { columns: ["2025"], rows: [{ id: "revenue", label: "Revenue", values: [900000000000] }] },
        balance: { columns: ["2025"], rows: [{ id: "total_assets", label: "Total assets", values: [1500000000000] }] },
        cashflow: { columns: ["2025"], rows: [{ id: "ocf", label: "Operating cash flow", values: [120000000000] }] },
      }),
    });
  });
  await page.getByRole("button", { name: "Fetch financials" }).first().click();
  const fin = page.getByRole("dialog", { name: "Financials" });
  await expect(fin).toBeVisible();
  await expect(fin.getByText("ROE", { exact: true })).toBeVisible();
  await expect(fin.getByText("ROCE", { exact: true })).toBeVisible();
  await expect(fin.getByText("PE", { exact: true })).toBeVisible();
  await expect(fin.getByRole("heading", { name: "Profit & loss" })).toBeVisible();
  await expect(fin.getByRole("heading", { name: "Balance sheet" })).toBeVisible();
  await expect(fin.getByRole("heading", { name: "Cash flow" })).toBeVisible();
});
