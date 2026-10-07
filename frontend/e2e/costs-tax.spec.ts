import { expect, test } from "@playwright/test";
import { registerAccount } from "./helpers";

test("paper trading shows charges before the order, keeps a ledger and a capital-gains view", async ({ page }) => {
  await registerAccount(page, { first: "Cost", last: "Trader" });
  await page.getByRole("button", { name: /Paper trading/ }).click();
  await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: "Watchlist" }).click();
  await page.locator('.wl-row[data-symbol="TCS"]').click();
  await page.getByRole("tab", { name: "Trade" }).click();

  // The ticket prices the order before it is placed: every charge on its own line.
  const ticket = page.getByRole("region", { name: "Order ticket" });
  await ticket.getByRole("button", { name: /Estimated charges/ }).click();
  for (const line of ["Brokerage", "STT/CTT", "Exchange transaction charges", "SEBI charges", "Stamp duty", "GST", "Total charges"]) {
    await expect(ticket.getByText(line, { exact: true }).first()).toBeVisible();
  }
  await expect(ticket.getByText(/Charges are simulated and may differ from your actual broker\./)).toBeVisible();
  // Only delivery trading exists: there is no product to choose.
  await expect(ticket.getByRole("button", { name: "Intraday" })).toHaveCount(0);

  // A sale needs shares you hold, and the ticket says so instead of offering a short sale.
  await ticket.getByRole("button", { name: "SELL", exact: true }).click();
  await expect(ticket.getByText("You don’t own this stock")).toBeVisible();
  await ticket.getByRole("button", { name: "Buy instead" }).click();

  await ticket.getByRole("button", { name: /^BUY TCS/ }).click();
  const summary = page.getByRole("dialog", { name: "Confirm order" });
  await expect(summary.getByText("Estimated charges")).toBeVisible();
  await summary.getByText("How the charges add up").click();
  await expect(summary.getByText("Total charges")).toBeVisible();
  await summary.getByRole("button", { name: "Confirm Buy" }).click();
  await page.getByRole("button", { name: "Done" }).click();

  // The ledger lists the execution; a row opens the breakdown with amounts and rates.
  await page.locator(".blot-bar").getByRole("button", { name: "History" }).click();
  await page.getByRole("button", { name: "Charge detail" }).click();
  await expect(page.getByRole("table", { name: "Transaction ledger" })).toBeVisible();
  await page.getByRole("table", { name: "Transaction ledger" }).locator("tbody tr").first().click();
  const sheet = page.getByRole("dialog", { name: "Charge breakdown" });
  await expect(sheet.getByText("External charges/taxes")).toBeVisible();
  await sheet.getByRole("tab", { name: "Rate" }).click();
  await expect(sheet.locator(".cx-row", { hasText: "GST" })).toContainText("18%");
  await expect(sheet.locator(".cx-row", { hasText: "Stamp duty" })).toContainText("0.015%");
  await page.keyboard.press("Escape");

  // Capital gains: realised and unrealised kept apart, an estimate that says what it is.
  await page.getByLabel("Capital gains").first().click();
  await expect(page.getByRole("heading", { name: "Capital gains", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unrealised gains" })).toBeVisible();
  await expect(page.getByText("Estimated tax before surcharge and cess").first()).toBeVisible();
  await expect(page.getByText("Based on available transaction history and current applicable tax rules.").first()).toBeVisible();
  await expect(page.getByText("Tax calculations are not tax advice.").first()).toBeVisible();
  await page.getByText("How are charges and taxes calculated?").click();
  await expect(page.getByRole("heading", { name: "STT/CTT" })).toBeVisible();
});

test("mutual funds: Tax & costs lot by lot, a redemption preview that never invents an exit load", async ({ page }) => {
  await registerAccount(page, { first: "Fund", last: "Taxer" });
  const added = await page.context().request.post("/v1/funds/holdings", { data: { scheme_code: 122639, amount: 50000, purchase_date: new Date(Date.now() - 500 * 86_400_000).toISOString().slice(0, 10) } });
  expect(added.status()).toBe(201);

  await page.goto("/funds#tax");
  await expect(page.getByRole("heading", { name: "Tax & costs", level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Realised gains", { exact: true })).toBeVisible();
  await expect(page.getByText("Potential tax exposure on redemption").first()).toBeVisible();
  await expect(page.getByText("This estimate assumes the currently selected tax classification and available transaction history.").first()).toBeVisible();
  await expect(page.locator(".cx-conf-pill").first()).toBeVisible();
  await expect(page.getByText("Equity-oriented fund").first()).toBeVisible();
  await expect(page.getByText("is already reflected in the NAV").first()).toBeVisible();

  await page.getByRole("button", { name: /Redeem/ }).first().click();
  const dialog = page.getByRole("dialog", { name: /Redeem/ });
  await expect(dialog.getByText("Gross redemption")).toBeVisible({ timeout: 20_000 });
  // A sheet must cover the whole viewport. An ancestor that keeps a transform (an entrance animation left applied) would
  // make a fixed overlay measure itself against that ancestor and start part-way down the page.
  const overlay = await page.locator(".cx-overlay").boundingBox();
  const viewport = page.viewportSize()!;
  expect(overlay!.y).toBe(0);
  expect(overlay!.height).toBe(viewport.height);
  await expect(dialog.getByText("Exit load information unavailable.")).toBeVisible();
  await expect(dialog.getByText("Estimated net proceeds")).toBeVisible();
  await expect(dialog.getByText("Estimated tax impact")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Nothing was recorded by looking.
  const book = await (await page.context().request.get("/v1/funds")).json();
  expect(book.holdings).toHaveLength(1);

  // The per-fund page carries the same rules and the place to enter an exit load.
  await page.goto("/funds/122639");
  await expect(page.getByRole("heading", { name: "Tax and exit load" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Exit load information unavailable.").first()).toBeVisible();
});
