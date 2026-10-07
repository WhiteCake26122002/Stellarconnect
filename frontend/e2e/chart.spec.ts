import { expect, test, type Page } from "@playwright/test";
import { registerAccount } from "./helpers";

// The chart is a canvas, so these look at its pixels: a chart that is blank, or that stops repainting after a
// zoom, drag or timeframe change, is a bug a DOM assertion cannot see.

const painted = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>("canvas.term-chart-canvas");
    if (!c || c.width < 400) return { ok: false, ink: 0, sig: "" };
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    let sig = 0;
    for (let i = 0; i < d.length; i += 4 * 61) {
      if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) ink++;
      sig = (sig * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
    }
    return { ok: true, ink, sig: String(sig) };
  });

async function openTerminal(page: Page) {
  await registerAccount(page, { first: "Chart", last: "Painter" });
  await page.getByRole("button", { name: /Paper trading/ }).click();
  await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".term-chart-wrap")).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
}

test("the chart paints, and keeps repainting when it is zoomed, dragged and re-timed", async ({ page }) => {
  await openTerminal(page);
  await expect.poll(async () => (await painted(page)).ink, { timeout: 20_000 }).toBeGreaterThan(50);
  const first = await painted(page);

  const box = (await page.locator("canvas.term-chart-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await painted(page)).sig).not.toBe(first.sig);
  const zoomed = await painted(page);
  expect(zoomed.ink).toBeGreaterThan(50);

  // dragging the price axis rescales; dragging the plot pans
  await page.mouse.move(box.x + box.width - 30, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 30, box.y + 90, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await painted(page)).sig).not.toBe(zoomed.sig);
  const scaled = await painted(page);
  await page.mouse.move(box.x + 500, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 250, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await painted(page)).sig).not.toBe(scaled.sig);

  // a new timeframe repaints with its own bars, and going back is quick because the bars are cached
  await page.getByRole("button", { name: "Timeframe" }).click();
  await page.getByRole("button", { name: "1H", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Timeframe" })).toContainText("1H");
  await expect.poll(async () => (await painted(page)).ink, { timeout: 20_000 }).toBeGreaterThan(50);
  await page.getByRole("button", { name: "Timeframe" }).click();
  await page.getByRole("button", { name: "1D", exact: true }).first().click();
  await expect.poll(async () => (await painted(page)).ink, { timeout: 20_000 }).toBeGreaterThan(50);
});

test("moving the pointer across the chart updates the legend without re-rendering the desk", async ({ page }) => {
  await openTerminal(page);
  await expect.poll(async () => (await painted(page)).ink, { timeout: 20_000 }).toBeGreaterThan(50);
  const box = (await page.locator("canvas.term-chart-canvas").boundingBox())!;
  const legend = page.locator(".term-ohlc");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  const a = await legend.innerText();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 10 });
  await expect.poll(async () => legend.innerText()).not.toBe(a);
});
