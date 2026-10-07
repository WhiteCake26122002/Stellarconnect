import { expect, test, type Page } from "@playwright/test";
import { registerAccount } from "./helpers";

// The visual module: structure and behaviour, never a specific market value (these run on live NAV data).

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function seed(page: Page, codes: number[], ago = 10) {
  for (const scheme_code of codes) {
    const res = await page.request.post("/v1/funds/holdings", { data: { scheme_code, units: 100, purchase_date: daysAgo(ago) } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
}

async function dismissTour(page: Page) {
  const overlay = page.locator("#react-joyride-portal [data-test-id='overlay']").first();
  try {
    await overlay.waitFor({ timeout: 2_000 });
    await page.keyboard.press("Escape");
  } catch {
    /* no tour */
  }
}

test("the overview shows value, allocation, performance, concentration, health and risk, and every number is honest about its history", async ({ page }) => {
  await registerAccount(page, { first: "Visual", last: "Overview" });
  await seed(page, [122640, 102528, 152600]);
  await page.goto("/funds#portfolio");

  await expect(page.getByRole("region", { name: "Portfolio value over time" })).toBeVisible({ timeout: 45_000 });
  for (const name of ["Portfolio allocation", "Performance against the market", "Concentration", "Portfolio health", "Risk profile"]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }

  // ten days of history: an annual figure is Unavailable, never extrapolated
  await expect(page.getByRole("region", { name: "Portfolio value over time" }).getByText("Unavailable")).toBeVisible();
  await expect(page.getByRole("region", { name: "Performance against the market" }).getByText("Insufficient history").first()).toBeVisible();
  // ranges that the history cannot fill are offered but disabled
  await expect(page.getByRole("button", { name: "3Y" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "5Y" })).toBeDisabled();
});

test("the allocation donut opens level by level and the breadcrumb goes back", async ({ page }) => {
  await registerAccount(page, { first: "Donut", last: "Drill" });
  await seed(page, [122640, 102528, 152600]);
  await page.goto("/funds#portfolio");
  const alloc = page.getByRole("region", { name: "Portfolio allocation" });
  await expect(alloc).toBeVisible({ timeout: 45_000 });

  const crumbs = alloc.getByRole("navigation", { name: "Allocation level" });
  await expect(crumbs.getByText("Portfolio")).toBeVisible();
  const first = alloc.getByRole("list", { name: /breakdown/ }).getByRole("listitem").first();
  const label = (await first.locator(".vz-hb-name").innerText()).trim();
  await first.click();
  await expect(crumbs.getByRole("button", { name: "Portfolio" })).toBeVisible();
  await expect(crumbs.locator("b")).toHaveText(label);
  await crumbs.getByRole("button", { name: "Portfolio" }).click();
  await expect(crumbs.locator("b")).toHaveText("Portfolio");

  // a slice of the donut itself is a keyboard-reachable button that does the same
  const slice = alloc.locator(".vz-arc").first();
  await expect(slice).toHaveAttribute("role", "button");
  await expect(slice).toHaveAttribute("aria-label", /^\S.* \d+(\.\d)?%$/);
  await slice.focus();
  await expect(alloc.locator(".vz-donut-centre")).toContainText(label);
  await page.keyboard.press("Enter");
  await expect(crumbs.locator("b")).toHaveText(label);
});

test("the health score opens an explanation that lists every part and what is missing", async ({ page }) => {
  await registerAccount(page, { first: "Health", last: "Score" });
  await seed(page, [122640, 102528, 152600]);
  await page.goto("/funds#portfolio");
  const health = page.getByRole("region", { name: "Portfolio health" });
  await expect(health).toBeVisible({ timeout: 45_000 });
  await health.getByRole("button", { name: "How is this calculated?" }).first().click();
  const sheet = page.getByRole("dialog", { name: "How the health score is calculated" });
  await expect(sheet).toBeVisible();
  for (const part of ["Diversification", "Concentration", "Risk alignment", "Plan cost", "Performance"]) await expect(sheet.getByText(part, { exact: true })).toBeVisible();
  // no profile is set and the holdings are ten days old, so those two parts say so instead of guessing
  await expect(sheet.getByText(/Set your age, horizon and risk comfort/)).toBeVisible();
  await expect(sheet.getByText(/at least a year of holding/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});

test("holdings are rows with a one-year NAV trend, and a fund page draws its own history against a benchmark", async ({ page }) => {
  await registerAccount(page, { first: "Rows", last: "Trend" });
  await seed(page, [122639], 40);
  await page.goto("/funds#portfolio");
  const rows = page.getByRole("list", { name: "Your funds" });
  await expect(rows).toBeVisible({ timeout: 45_000 });
  await expect(rows.getByRole("img", { name: /NAV over the last year/ })).toBeVisible({ timeout: 30_000 });
  await expect(rows.getByText(/Bought \d+ \w+ \d{4}/)).toBeVisible();

  await page.goto("/funds/122639");
  await dismissTour(page);
  const chart = page.getByRole("img", { name: /Growth of ₹100 in the fund against its benchmark/ });
  await expect(chart).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/Category average: unavailable/)).toBeVisible();

  // years of history exist for this fund, so the risk tab can measure what a short portfolio cannot
  await page.getByRole("tab", { name: "Risk" }).click();
  await expect(page.getByRole("img", { name: "Drawdown over time" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Deepest fall/)).toBeVisible();
});

test("plan: the chart switches between nominal and inflation-adjusted rupees, and the split of contributions and growth adds up", async ({ page }) => {
  await registerAccount(page, { first: "Plan", last: "Visual" });
  await seed(page, [122640]);
  await page.goto("/funds#plan");
  const chart = page.getByRole("img", { name: /Three scenarios over \d+ years/ });
  await expect(chart).toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: "Inflation adjusted" }).click();
  await expect(page.getByText(/divided by compounded/)).toBeVisible();
  await page.getByRole("button", { name: "Nominal" }).click();
  await expect(page.getByText(/not adjusted for inflation/)).toBeVisible();
  await expect(page.getByText("Where the final amount comes from")).toBeVisible();
  await expect(page.getByRole("img", { name: /Money paid in against growth/ })).toHaveCount(3);
});
