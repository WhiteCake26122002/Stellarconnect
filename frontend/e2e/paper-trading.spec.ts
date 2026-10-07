import { expect, test, type Page } from "@playwright/test";
import { registerAccount } from "./helpers";

// Paper trading: one ticket, market orders only, long only, charges that reach the books, a dashboard whose figures
// come from one account, and a heat map tooltip that stays inside the window.

async function openDesk(page: Page) {
  await registerAccount(page, { first: "Paper", last: "Trader" });
  await page.goto("/terminal");
  await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 40_000 });
}

async function pickFromWatchlist(page: Page, symbol: string) {
  await page.getByRole("tab", { name: "Watchlist" }).click();
  await page.locator(`.wl-row[data-symbol="${symbol}"]`).click();
  await page.getByRole("tab", { name: "Trade" }).click();
  await expect(page.getByRole("region", { name: "Order ticket" })).toBeVisible();
}

const qty = (page: Page) => page.getByLabel("Quantity", { exact: true });

test("buy: search, open, quantity, review, confirm, and the books move", async ({ page }) => {
  await openDesk(page);
  await pickFromWatchlist(page, "RELIANCE");
  const ticket = page.getByRole("region", { name: "Order ticket" });
  await expect(ticket.getByText("Reliance Industries", { exact: true })).toBeVisible();
  await qty(page).fill("10");

  // Everything the buyer needs, before committing.
  for (const row of ["Estimated price", "Trade value", "Total required", "Available cash", "Cash after trade"]) {
    await expect(ticket.getByText(row, { exact: true })).toBeVisible();
  }
  const cashBefore = await page.getByLabel("Paper balances").locator(".cash dd").innerText();

  await ticket.getByRole("button", { name: "BUY RELIANCE", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Confirm order" });
  await expect(review.getByText("BUY RELIANCE")).toBeVisible();
  await expect(review.getByText("10 shares")).toBeVisible();
  await review.getByRole("button", { name: "Confirm Buy" }).click();

  const done = page.getByRole("dialog", { name: "Order executed" });
  await expect(done.getByText("Buy order executed")).toBeVisible();
  await expect(done.getByText("Realized P&L")).toHaveCount(0);
  await done.getByRole("button", { name: "View position →" }).click();

  // The position appears, the cash fell, and the position table agrees with the order.
  await expect(page.getByRole("table", { name: "Positions" }).getByRole("cell", { name: "Reliance Industries", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Positions" }).locator("tbody tr").first().locator("td").nth(1)).toHaveText("10");
  await expect(page.getByLabel("Paper balances").locator(".cash dd")).not.toHaveText(cashBefore);
});

test("sell: position-aware, never more than owned, and nothing to sell says why", async ({ page }) => {
  await openDesk(page);
  await pickFromWatchlist(page, "TCS");
  const ticket = page.getByRole("region", { name: "Order ticket" });

  // Owning nothing: a clear explanation and a way to buy instead, not a short sale.
  await ticket.getByRole("button", { name: "SELL", exact: true }).click();
  await expect(ticket.getByText("You don’t own this stock")).toBeVisible();
  await expect(ticket.getByText("You can only sell stocks currently held in your portfolio.")).toBeVisible();
  await ticket.getByRole("button", { name: "Buy instead" }).click();

  await qty(page).fill("10");
  await ticket.getByRole("button", { name: "BUY TCS", exact: true }).click();
  await page.getByRole("button", { name: "Confirm Buy" }).click();
  await page.getByRole("button", { name: "Done" }).click();

  // Own 10: the ticket shows the position and caps the quantity at what is held.
  await ticket.getByRole("button", { name: "SELL", exact: true }).click();
  await expect(ticket.getByLabel("Your Tata Consultancy Services position")).toContainText("Owned quantity");
  await qty(page).fill("11");
  await expect(ticket.getByRole("alert").filter({ hasText: "at most 10" })).toBeVisible();
  // The button explains itself and the review never opens.
  await ticket.getByRole("button", { name: "SELL TCS", exact: true }).click({ force: true });
  await expect(page.getByRole("dialog", { name: "Confirm order" })).toHaveCount(0);

  await qty(page).fill("4");
  await expect(ticket.getByText("6 shares")).toBeVisible(); // remaining
  await ticket.getByRole("button", { name: "SELL TCS", exact: true }).click();
  await page.getByRole("button", { name: "Confirm Sell" }).click();
  const done = page.getByRole("dialog", { name: "Order executed" });
  await expect(done.getByText("Realized P&L")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await page.locator(".blot-bar").getByRole("button", { name: "Positions" }).click();
  await expect(page.getByRole("table", { name: "Positions" }).locator("tbody tr").first().locator("td").nth(1)).toHaveText("6");
});

test("insufficient cash shows the shortfall instead of silently refusing", async ({ page }) => {
  await openDesk(page);
  await pickFromWatchlist(page, "RELIANCE");
  const ticket = page.getByRole("region", { name: "Order ticket" });
  await qty(page).fill("1000000");
  await expect(ticket.getByRole("alert").filter({ hasText: "Insufficient cash" })).toBeVisible();
  await expect(ticket.getByText("Shortfall", { exact: true })).toBeVisible();
  const cta = ticket.getByRole("button", { name: "BUY RELIANCE", exact: true });
  await expect(cta).toHaveAttribute("aria-disabled", "true");
  await cta.click({ force: true });
  await expect(page.getByRole("dialog", { name: "Confirm order" })).toHaveCount(0);
  // Zero and fractional quantities are refused with a reason too.
  await qty(page).fill("0");
  await expect(ticket.getByRole("alert")).toContainText("quantity of at least 1");
  await qty(page).fill("2.5");
  await expect(ticket.getByRole("alert")).toContainText("whole numbers");
});

test("market orders only: no order types, stops, margin or short selling anywhere in the ticket", async ({ page }) => {
  await openDesk(page);
  await pickFromWatchlist(page, "INFY");
  const ticket = page.getByRole("region", { name: "Order ticket" });
  const text = (await ticket.innerText()).toLowerCase();
  for (const word of ["limit", "stop", "trigger", "leverage", "margin", "intraday", "order type", "short"]) {
    expect(text, word).not.toContain(word);
  }
  await expect(ticket.getByRole("combobox")).toHaveCount(0);
  // Esc closes the confirmation without placing anything.
  await qty(page).fill("1");
  await ticket.getByRole("button", { name: "BUY INFY", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Confirm order" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Confirm order" })).toHaveCount(0);
  await page.locator(".blot-bar").getByRole("button", { name: "Orders" }).click();
  await expect(page.getByText("No orders yet")).toBeVisible();
});

test("the overview is a dashboard of one account: market, portfolio, performance, heat map, watchlist, positions, analytics", async ({ page }) => {
  await openDesk(page);
  await pickFromWatchlist(page, "RELIANCE");
  await qty(page).fill("5");
  await page.getByRole("button", { name: "BUY RELIANCE", exact: true }).click();
  await page.getByRole("button", { name: "Confirm Buy" }).click();
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("navigation", { name: "Desk views" }).getByRole("button", { name: "Overview" }).click();
  for (const name of ["Market overview", "Your portfolio", "Portfolio performance", "Market heat map", "My Watchlist", "Positions", "Portfolio analytics"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  // Market status is honest: never "live".
  await expect(page.getByRole("status").filter({ hasText: /Market open|Market closed|Delayed data|Simulated prices|Waiting for prices/ })).toBeVisible();
  await expect(page.locator(".pt-status")).not.toContainText(/live/i);
  // Summary, donut and positions table come from the same account.
  const summary = page.getByLabel("Portfolio summary");
  for (const label of ["Portfolio value", "Total P&L", "Today’s P&L", "Cash"]) await expect(summary.getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /Portfolio allocation: .*Reliance Industries .*Cash/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Daily profit and loss|No daily results/ }).or(page.getByText("No daily results yet"))).toBeVisible();
  await expect(page.getByLabel("Sector breakdown")).toBeVisible();
  // The donut opens the position's chart.
  const arc = page.locator(".pt-arc.link").first();
  await expect(arc).toHaveAttribute("aria-label", /Reliance Industries .*open position/);
  await arc.focus();
  await expect(page.locator(".pt-donut-centre")).toContainText("Reliance Industries");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Reliance Industries" })).toBeVisible();
});

test("a stock found in search shows its price, and says what you own", async ({ page }) => {
  await openDesk(page);
  await pickFromWatchlist(page, "RELIANCE");
  await qty(page).fill("3");
  await page.getByRole("button", { name: "BUY RELIANCE", exact: true }).click();
  await page.getByRole("button", { name: "Confirm Buy" }).click();
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Search symbol" }).click();
  await page.getByLabel("Search stocks, ETFs and indices").or(page.getByLabel("Search stocks, ETFs, indices")).or(page.locator("#sym-search")).first().fill("Reliance Ind");
  const hit = page.locator(".pt-hit", { hasText: "Reliance Industries" }).first();
  await expect(hit).toBeVisible({ timeout: 20_000 });
  await expect(hit.getByText("You own 3 shares")).toBeVisible();
  await expect(hit).toContainText("₹", { timeout: 20_000 });
});

test("the heat map tooltip stays inside the window at every corner and edge, at several sizes", async ({ page }) => {
  await openDesk(page);
  const tiles = Array.from({ length: 24 }, (_, i) => ({
    symbol: `TST${i}`,
    name: `Test Company ${i} Industries Limited`,
    industry: ["Energy", "Banks", "Software", "Autos"][i % 4],
    last: 100 + i * 13,
    change_pct: (i % 2 ? 1 : -1) * 0.004 * (i + 1),
    market_cap: 1e12 / (i + 1),
    live: true,
  }));
  await page.route("**/v1/market/heatmap**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ index: "Nifty 50", range: "D", live: true, tiles }) }),
  );
  await page.getByRole("navigation", { name: "Desk views" }).getByRole("button", { name: "Heat map" }).click();
  await expect(page.locator("rect.heat-tile").first()).toBeVisible();

  for (const size of [{ width: 1440, height: 900 }, { width: 1180, height: 700 }, { width: 1000, height: 600 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(400);
    const boxes = await page.locator("rect.heat-tile").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
    const vis = boxes.filter((b) => b.w > 6 && b.h > 6 && b.x >= 0 && b.y >= 0 && b.x + b.w <= size.width && b.y + b.h <= size.height);
    expect(vis.length).toBeGreaterThan(4);
    const pick = (score: (b: (typeof vis)[number]) => number) => vis.reduce((a, b) => (score(b) > score(a) ? b : a));
    const spots = [
      { name: "top-left", b: pick((b) => -(b.x + b.y)), at: (b: (typeof vis)[number]) => [b.x + 2, b.y + 2] },
      { name: "top-right", b: pick((b) => b.x + b.w - b.y), at: (b: (typeof vis)[number]) => [b.x + b.w - 2, b.y + 2] },
      { name: "bottom-left", b: pick((b) => -b.x + b.y + b.h), at: (b: (typeof vis)[number]) => [b.x + 2, b.y + b.h - 2] },
      { name: "bottom-right", b: pick((b) => b.x + b.w + b.y + b.h), at: (b: (typeof vis)[number]) => [b.x + b.w - 2, b.y + b.h - 2] },
    ];
    for (const spot of spots) {
      const [x, y] = spot.at(spot.b);
      await page.mouse.move(x - 30, y - 30);
      await page.mouse.move(x, y, { steps: 4 });
      const tip = page.locator("#pt-heat-tip.ready");
      await expect(tip, `${spot.name} at ${size.width}x${size.height}`).toBeVisible();
      const r = await tip.boundingBox();
      expect(r, spot.name).not.toBeNull();
      expect(r!.x, `${spot.name} left`).toBeGreaterThanOrEqual(0);
      expect(r!.y, `${spot.name} top`).toBeGreaterThanOrEqual(0);
      expect(r!.x + r!.width, `${spot.name} right`).toBeLessThanOrEqual(size.width);
      expect(r!.y + r!.height, `${spot.name} bottom`).toBeLessThanOrEqual(size.height);
      await expect(tip).toContainText("Click to trade");
    }
    await page.mouse.move(2, 2);
  }
  // Clicking a tile opens that stock's workspace.
  await page.locator("rect.heat-tile").first().click();
  await expect(page.getByRole("navigation", { name: "Desk views" }).getByRole("button", { name: "Chart" })).toHaveAttribute("aria-current", "page");
});

test("on a phone the ticket is a bottom sheet with large touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDesk(page);
  await page.getByRole("navigation", { name: "Mobile" }).getByRole("button", { name: "trade", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: /Order ticket for/ });
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box!.y + box!.height).toBeGreaterThanOrEqual(843); // docked to the bottom
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  for (const b of [sheet.getByRole("button", { name: "BUY", exact: true }), sheet.getByRole("button", { name: "Increase quantity" }), sheet.locator(".pt-cta")]) {
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await sheet.getByRole("button", { name: "Close order ticket" }).click();
  await expect(sheet).toHaveCount(0);
});

test("reduced motion: nothing is animated, the same information is shown", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDesk(page);
  await pickFromWatchlist(page, "INFY");
  await qty(page).fill("2");
  await page.getByRole("button", { name: "BUY INFY", exact: true }).click();
  await page.getByRole("button", { name: "Confirm Buy" }).click();
  const done = page.getByRole("dialog", { name: "Order executed" });
  await expect(done).toBeVisible();
  expect(await done.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  expect(await done.locator(".pt-tick path").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("navigation", { name: "Desk views" }).getByRole("button", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Portfolio analytics" })).toBeVisible();
  expect(await page.locator(".pt-reveal").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await expect(page.getByLabel("Sector breakdown")).toBeVisible();
});
