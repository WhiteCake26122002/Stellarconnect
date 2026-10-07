import { expect, test, type Page } from "@playwright/test";
import { registerAccount } from "./helpers";

// The Home page is a scroll-driven film. These check that each scene is driven by the scroll, that the visitor can take
// the tour or stop it, that a phone never scrolls sideways, and that reduced motion gets the finished picture.

const prop = (page: Page, sel: string, name: string) => page.locator(sel).evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);

async function scrollInto(page: Page, sel: string, fraction: number) {
  await page.locator(sel).evaluate((el, f) => {
    const r = el.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + r.top + (r.height - window.innerHeight) * f);
  }, fraction);
  await page.waitForTimeout(450);
}

test("signed out: the headline, the three desks, and every scene is driven by the scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Three desks\.\s*One account\./ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create account" }).first()).toBeVisible();
  await expect(page.getByLabel("At a glance")).toContainText("₹10,00,000");
  await expect(page.getByRole("list", { name: "The three desks" })).toContainText("Paper trading");

  // The hero figure dissolves from one desk to the next on its own.
  await expect(page.locator(".cn-morph-key li.on")).toContainText("Paper trading");
  await expect(page.locator(".cn-morph-key li.on")).toContainText("Private DCF", { timeout: 9_000 });

  // The teal frame draws as the page scrolls into its stage.
  await scrollInto(page, ".cn-frame-sec", 0);
  const drawn0 = Number(await prop(page, ".cn-frame-sec", "--draw"));
  await scrollInto(page, ".cn-frame-sec", 0.9);
  const drawn1 = Number(await prop(page, ".cn-frame-sec", "--draw"));
  expect(drawn1).toBeGreaterThan(drawn0);
  expect(drawn1).toBeGreaterThan(0.95);
  await expect(page.getByRole("heading", { name: /Keep learning forward/i })).toBeVisible();
  await expect(page.getByRole("list", { name: "The desks" }).getByRole("link", { name: /Paper trading/ })).toHaveAttribute("href", "/terminal");

  // The route draws and its stops light up in order.
  await scrollInto(page, ".cn-route-sec", 0.1);
  const early = await page.locator(".cn-stop.on").count();
  await scrollInto(page, ".cn-route-sec", 0.99);
  const late = await page.locator(".cn-stop.on").count();
  expect(late).toBeGreaterThan(early);
  expect(late).toBe(5);

  // The timeline brings each step forward in turn.
  await scrollInto(page, ".cn-time-sec", 0.02);
  await expect(page.locator(".cn-card.on h3")).toHaveText("One account");
  await scrollInto(page, ".cn-time-sec", 0.98);
  await expect(page.locator(".cn-card.on h3")).toHaveText("AMFI book");

  // The existing desk rooms and the FAQ are still there, and a desk room opens its desk.
  await page.locator("#desks").scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: /Paper trading/ }).first()).toBeVisible();
  await page.locator("#faq").scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: /Is any of this real money/ })).toBeVisible();
});

test("the hero figure dissolves with no frame where both desks show, or where the swap is half done", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cn-morph-key li.on")).toContainText("Paper trading");
  // Sample every frame through one whole dissolve. Each square must show the old desk or the new one (the two masks are
  // complementary), and once the new desk is the only layer every square must be back to "old".
  const bad = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const problems: string[] = [];
        const began = performance.now();
        let sawIncoming = false;
        const tick = () => {
          const layers = document.querySelectorAll(".cn-morph-layer").length;
          const ins = [...document.querySelectorAll<SVGRectElement>("mask[id^='in'] rect[style]")];
          const outs = [...document.querySelectorAll<SVGRectElement>("mask[id^='out'] rect[style]")];
          if (layers === 2) sawIncoming = true;
          ins.forEach((r, i) => {
            if (outs[i] && r.style.opacity !== outs[i].style.opacity) problems.push("masks disagree");
          });
          if (layers === 1 && ins.some((r) => Number(r.style.opacity) > 0)) problems.push("single layer with open squares");
          if (performance.now() - began < 6500) requestAnimationFrame(tick);
          else resolve(sawIncoming ? [...new Set(problems)] : ["no dissolve seen"]);
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(bad).toEqual([]);
});

test("the desk rooms lean in, the hovered one widens, and a click opens its desk", async ({ page }) => {
  await page.goto("/");
  await page.locator("#desks").scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(600);
  const rooms = page.locator(".cn-room");
  await expect(rooms).toHaveCount(3);
  const before = (await rooms.nth(1).boundingBox())!.width;
  const box = (await rooms.nth(1).boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3);
  await expect(rooms.nth(1)).toHaveClass(/hot/);
  await expect(page.locator(".cn-desks-hint")).toContainText("Click DCF to load that desk");
  await page.waitForTimeout(800);
  expect((await rooms.nth(1).boundingBox())!.width).toBeGreaterThan(before + 40); // the grid gave it more room
  expect(await rooms.nth(1).evaluate((el) => el.style.getPropertyValue("--px"))).not.toBe(""); // the light follows the pointer
  await page.mouse.move(2, 2);
  await expect(page.locator(".cn-room.hot")).toHaveCount(0);
  await rooms.nth(1).click();
  // A signed-out visitor is sent on to sign in, so the desk's own page may already have redirected by the time we look.
  await expect(page).toHaveURL(/\/(models|login)/);
});

test("the questions open one at a time, and the closing band's Top button returns to the start", async ({ page }) => {
  await page.goto("/");
  await page.locator("#faq").scrollIntoViewIfNeeded();
  const first = page.getByRole("button", { name: /Is any of this real money/ });
  const second = page.getByRole("button", { name: /Where do the prices come from/ });
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("never sent to a broker or exchange")).toBeVisible();
  await second.click();
  await expect(second).toHaveAttribute("aria-expanded", "true");
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("never sent to a broker or exchange")).toBeHidden(); // closed answers are out of the tab order too
  await expect(page.getByText("last Yahoo Finance quote")).toBeVisible();
  await page.getByRole("button", { name: /^Top/ }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: /^Top/ }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 8000 }).toBeLessThan(5);
});

test("the route's five labels never overlap each other or sit on the line, at any desktop width", async ({ page }) => {
  for (const [w, h] of [[1920, 950], [1440, 900], [1280, 720], [1100, 800], [940, 700]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/");
    await scrollInto(page, ".cn-route-sec", 0.99);
    const res = await page.evaluate(() => {
      const labels = [...document.querySelectorAll(".cn-stop .lbl")].map((e, i) => { const r = e.getBoundingClientRect(); return { i: i + 1, l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      const overlapping: number[][] = [];
      for (let a = 0; a < labels.length; a++) for (let b = a + 1; b < labels.length; b++) {
        const A = labels[a], B = labels[b];
        if (A.l < B.r && B.l < A.r && A.t < B.b && B.t < A.b) overlapping.push([A.i, B.i]);
      }
      const path = document.querySelector<SVGPathElement>(".cn-route .line")!;
      const sr = path.ownerSVGElement!.getBoundingClientRect();
      const sc = sr.width / 1000;
      const len = path.getTotalLength();
      const crossed = new Set<number>();
      for (let k = 0; k <= 600; k++) {
        const p = path.getPointAtLength((len * k) / 600);
        const x = p.x * sc + sr.left;
        const y = p.y * sc + sr.top + (sr.height - 560 * sc) / 2;
        for (const L of labels) if (x > L.l - 2 && x < L.r + 2 && y > L.t - 2 && y < L.b + 2) crossed.add(L.i);
      }
      return { overlapping, crossed: [...crossed] };
    });
    expect(res, `${w}px`).toEqual({ overlapping: [], crossed: [] });
  }
});

test("the tour scrolls by itself and stops the moment the visitor takes over", async ({ page }) => {
  await page.goto("/");
  const tour = page.getByRole("button", { name: /Take the tour/ });
  await tour.click();
  await expect(page.getByRole("button", { name: /Stop the tour/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 8000 }).toBeGreaterThan(100); // a busy machine only makes it slower
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: /Take the tour/ })).toBeVisible();
  const y2 = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(600);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y2)).toBeLessThan(80);
});

test("signed in: welcomed back by name, with a way into the desks", async ({ page }) => {
  await registerAccount(page, { first: "Home", last: "Viewer" });
  await page.goto("/");
  await expect(page.locator(".cn-tag")).toContainText("Welcome back, Home");
  await expect(page.getByRole("link", { name: "Choose a desk" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create account" })).toHaveCount(0);
});

test("a phone never scrolls sideways and keeps every scene readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const [sel, f] of [[".cn-hero", 0], [".cn-frame-sec", 0.9], [".cn-route-sec", 0.99], [".cn-time-sec", 0.5]] as const) {
    if (sel === ".cn-hero") await page.evaluate(() => window.scrollTo(0, 0));
    else await scrollInto(page, sel, f);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), sel).toBe(true);
  }
  // On a narrow screen the route shows one caption for the current stop rather than five labels that would collide.
  await scrollInto(page, ".cn-route-sec", 0.99);
  await expect(page.locator(".cn-route-cap")).toBeVisible();
  await expect(page.locator(".cn-stop .lbl").first()).toBeHidden();
});

test("reduced motion: the finished picture, nothing scrubbing, nothing looping", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /Take the tour/ })).toHaveCount(0);
  const stage = await page.locator(".cn-time-sec").evaluate((el) => ({ section: el.getBoundingClientRect().height, vh: window.innerHeight }));
  expect(stage.section).toBeLessThan(stage.vh * 4); // no 5-screen pinned run
  // Every timeline card is simply there, one after another.
  const cards = page.locator(".cn-card");
  await expect(cards).toHaveCount(4);
  for (let i = 0; i < 4; i++) await expect(cards.nth(i)).toBeVisible();
  expect((await page.locator(".cn-morph-key li.on").innerText()).toLowerCase()).toContain("paper trading");
  await page.waitForTimeout(4200);
  expect((await page.locator(".cn-morph-key li.on").innerText()).toLowerCase()).toContain("paper trading"); // it does not cycle
  expect(Number(await prop(page, ".cn-frame-sec", "--draw"))).toBe(1);
  expect(await page.locator(".cn-hero h1 .ln > span").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});
