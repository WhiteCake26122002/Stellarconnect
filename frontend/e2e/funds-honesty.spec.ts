import { expect, test, type Page } from "@playwright/test";
import { registerAccount } from "./helpers";

// These run against live NAV and index data, so they assert on structure and on the rules the desk
// must keep (no annualizing a short window, no verdict without enough days, no number without a period),
// never on a specific market value.

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function seedRecentFunds(page: Page) {
  // Three schemes bought about ten days ago: the situation that used to show "XIRR -35%".
  for (const scheme_code of [122640, 102528, 152600]) {
    const res = await page.request.post("/v1/funds/holdings", { data: { scheme_code, units: 100, purchase_date: daysAgo(10) } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
}

/** The analytics tour starts on its own once the analysis has loaded and covers the page; close it if it did. */
async function dismissTour(page: Page) {
  const overlay = page.locator("#react-joyride-portal .react-joyride__overlay, #react-joyride-portal [data-test-id='overlay']").first();
  try {
    await overlay.waitFor({ timeout: 3_000 });
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
  } catch {
    /* no tour this time */
  }
}

async function openTab(page: Page, tab: string) {
  await page.goto(`/funds#${tab}`);
  await expect(page.getByRole("tab", { name: new RegExp(`^${tab}`, "i") })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
}

test("a ten-day-old portfolio is never shown as an annualized return", async ({ page }) => {
  await registerAccount(page, { first: "Honest", last: "Numbers" });
  await seedRecentFunds(page);
  await openTab(page, "analysis");

  await expect(page.locator(".mf-period")).toContainText("Measured over", { timeout: 45_000 });
  // the latest NAV can be a day or two behind today, so the window is "about ten" days, never a year
  const days = Number(((await page.locator(".mf-period").innerText()).match(/\((\d+) days?\)/) ?? [])[1]);
  expect(days).toBeGreaterThan(0);
  expect(days).toBeLessThanOrEqual(10);
  await expect(page.getByText("Annualized return", { exact: true })).toBeVisible();
  await expect(page.getByText("Not yet", { exact: true })).toBeVisible();
  await expect(page.getByText("XIRR (annualized)")).toHaveCount(0);
  await expect(page.getByText("Your XIRR")).toHaveCount(0);
  await expect(page.getByText(/Ahead of \d+\/\d+ benchmarks/)).toHaveCount(0);

  // every fund is compared with its own benchmark or says why not, and nothing is judged this early
  const table = page.getByRole("table").filter({ hasText: "Benchmark return" });
  await expect(table).toBeVisible();
  await expect(table.getByText(/Too early to call|Benchmark unavailable/).first()).toBeVisible();
  await expect(table.getByText("Outperformed", { exact: true })).toHaveCount(0);
  await expect(table.getByText("Underperformed", { exact: true })).toHaveCount(0);

  // risk measures wait for a year of data instead of printing n/a
  await expect(page.getByText("Not enough history").first()).toBeVisible();
  await expect(page.getByText(/Rolling returns need at least one full year/)).toBeVisible();

  // a stated source for every figure
  await dismissTour(page);
  await page.getByText("How these numbers were made").click();
  await expect(page.getByRole("rowheader", { name: "Category average" })).toBeVisible();
  await expect(page.getByText("Unavailable").first()).toBeVisible();
});

test("portfolio value chart does not read new money as return", async ({ page }) => {
  await registerAccount(page, { first: "Value", last: "Chart" });
  await seedRecentFunds(page);
  await openTab(page, "portfolio");
  const chart = page.getByRole("region", { name: "Portfolio value over time" });
  await expect(chart).toBeVisible({ timeout: 45_000 });
  await expect(chart.getByRole("button", { name: /Invested/ })).toBeVisible();
  await expect(chart.getByText(/Made in this range/)).toBeVisible();
  // the old headline divided end value by start value, which turned a purchase into a +400% "gain"
  const headline = await chart.getByText(/Made in this range/).innerText();
  const pct = headline.match(/\(([+−-]?\d+(?:\.\d+)?)%\)/);
  expect(pct, headline).not.toBeNull();
  expect(Math.abs(parseFloat((pct as RegExpMatchArray)[1].replace("−", "-")))).toBeLessThan(25);
});

test("a purchase on an earlier date is priced from that day's published NAV", async ({ page }) => {
  await registerAccount(page, { first: "Dated", last: "Buy" });
  await page.goto("/funds?add=122639#portfolio");
  await expect(page.getByLabel("Search scheme name")).toHaveValue(/Parag Parikh/, { timeout: 30_000 });
  await page.getByLabel("Units you bought").fill("10");
  await expect(page.getByText(/will be used as your purchase NAV/)).toBeVisible();
  await page.getByLabel("On an earlier date").check();
  await page.getByLabel("Purchase date").fill(daysAgo(30));
  await expect(page.getByText(/AMFI published ₹[\d,.]+ .* That will be your purchase NAV/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Add to portfolio" }).click();
  await expect(page.getByRole("link", { name: /Parag Parikh Flexi Cap Fund - Direct/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Bought \d+ \w+ \d{4}/).first()).toBeVisible();
});

test("a date before the scheme existed is refused with the reason", async ({ page }) => {
  await registerAccount(page, { first: "Early", last: "Date" });
  await page.goto("/funds?add=122639#portfolio");
  await expect(page.getByLabel("Search scheme name")).toHaveValue(/Parag Parikh/, { timeout: 30_000 });
  await page.getByLabel("Units you bought").fill("5");
  await page.getByLabel("On an earlier date").check();
  await page.getByLabel("Purchase date").fill("2000-01-03");
  await expect(page.getByText(/history starts|No NAV is published/)).toBeVisible({ timeout: 30_000 });
});

test("insights are prioritised, explained, and compare against a stated profile", async ({ page }) => {
  await registerAccount(page, { first: "Insight", last: "Profile" });
  await seedRecentFunds(page);
  await openTab(page, "insights");
  await expect(page.getByRole("heading", { name: /things worth knowing|one thing worth knowing/ })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Why this matters").first()).toBeVisible();
  await expect(page.getByText("What you can review").first()).toBeVisible();
  const text = (await page.locator("main").innerText()).toLowerCase();
  for (const banned of ["you should sell", "you should buy", "bad fund", "exit immediately", "is safe"]) expect(text).not.toContain(banned);
  // what cannot be said is stated, not omitted (it sits under "Also noted")
  await page.getByText(/^Also noted/).click();
  await expect(page.getByRole("heading", { name: "Holdings overlap unavailable" })).toBeVisible();

  await page.getByLabel("Risk tolerance").selectOption("conservative");
  await page.getByLabel("Investment horizon").selectOption("lt3");
  await expect(page.getByRole("heading", { name: "Allocation against your profile" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/educational reference range/i).first()).toBeVisible();
});

test("the plan shows three scenarios, in today's money, and says they are not predictions", async ({ page }) => {
  await registerAccount(page, { first: "Plan", last: "Scenarios" });
  await seedRecentFunds(page);
  await openTab(page, "plan");
  const group = page.getByRole("group", { name: /Estimated value after/ });
  await expect(group).toBeVisible({ timeout: 45_000 });
  for (const name of ["Conservative", "Base", "Optimistic"]) await expect(group.getByRole("heading", { name })).toBeVisible();
  await expect(group.getByText(/in today's money/)).toHaveCount(3);
  await expect(page.getByText(/not predictions or guaranteed returns/)).toBeVisible();

  const base = await group.locator(".mf-scenario.base strong").innerText();
  await page.getByLabel("Inflation assumed").fill("3");
  await expect(group.getByText(/in today's money/).first()).toBeVisible();
  expect(await group.locator(".mf-scenario.base strong").innerText()).toBe(base); // inflation changes today's-money, not the nominal corpus

  // scenarios must stay ordered
  await page.getByLabel("Conservative").fill("20");
  await expect(page.getByText(/Keep the scenarios in order/)).toBeVisible();
});

test("watchlist rows carry 1-day, 1-month and 1-year changes and can be compared", async ({ page }) => {
  await registerAccount(page, { first: "Watch", last: "List" });
  await page.goto("/funds#watchlist");
  await expect(page.getByRole("heading", { name: "Nothing on your watchlist yet" })).toBeVisible({ timeout: 30_000 });
  for (const code of [122639, 118955]) {
    await page.goto(`/funds/${code}`);
    await page.getByRole("button", { name: /Watch/ }).first().click();
  }
  await page.goto("/funds#watchlist");
  const card = page.locator(".mf-watch").first();
  await expect(card.getByText("1 day")).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText("1 month")).toBeVisible();
  await expect(card.getByText("1 year")).toBeVisible();
  await page.getByLabel("Compare").first().check();
  await page.getByLabel("Compare").nth(1).check();
  await expect(page.getByRole("heading", { name: "Side by side" })).toBeVisible();
});

test("every funds tab fits a phone screen without sideways scrolling", async ({ page }) => {
  await registerAccount(page, { first: "Phone", last: "Fit" });
  await seedRecentFunds(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ["portfolio", "watchlist", "analysis", "insights", "plan"]) {
    await openTab(page, tab);
    await page.waitForTimeout(2500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${tab} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
  }
});
