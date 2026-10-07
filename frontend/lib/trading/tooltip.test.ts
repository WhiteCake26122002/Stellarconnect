import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { placeTooltip } from "./tooltip";

const VP = { w: 1200, h: 800 };
const SIZE = { w: 220, h: 170 };
const M = 8;

/** The tooltip box must sit wholly inside the window, whatever the pointer does. */
function inside(p: { left: number; top: number }, size = SIZE, vp = VP) {
  assert.ok(p.left >= M, `left ${p.left}`);
  assert.ok(p.top >= M, `top ${p.top}`);
  assert.ok(p.left + size.w <= vp.w - M, `right edge ${p.left + size.w}`);
  assert.ok(p.top + size.h <= vp.h - M, `bottom edge ${p.top + size.h}`);
}

describe("placing a heat map tooltip", () => {
  it("goes below and to the right of the pointer when there is room", () => {
    const p = placeTooltip({ x: 300, y: 200 }, SIZE, VP);
    assert.deepEqual([p.x, p.y], ["right", "below"]);
    assert.deepEqual([p.left, p.top], [314, 214]);
  });

  it("the top-left cell: it stays below and right and inside the window", () => {
    const p = placeTooltip({ x: 0, y: 0 }, SIZE, VP);
    inside(p);
    assert.deepEqual([p.x, p.y], ["right", "below"]);
  });

  it("the top-right cell: it flips to the left", () => {
    const p = placeTooltip({ x: 1199, y: 2 }, SIZE, VP);
    inside(p);
    assert.equal(p.x, "left");
    assert.equal(p.y, "below");
  });

  it("the bottom-left cell: it flips above", () => {
    const p = placeTooltip({ x: 2, y: 799 }, SIZE, VP);
    inside(p);
    assert.equal(p.x, "right");
    assert.equal(p.y, "above");
  });

  it("the bottom-right cell: it flips both ways", () => {
    const p = placeTooltip({ x: 1199, y: 799 }, SIZE, VP);
    inside(p);
    assert.deepEqual([p.x, p.y], ["left", "above"]);
  });

  it("every edge and a sweep across the whole window never leaves the window", () => {
    for (let x = 0; x <= VP.w; x += 25) for (const y of [0, 1, 400, 799, 800]) inside(placeTooltip({ x, y }, SIZE, VP));
    for (let y = 0; y <= VP.h; y += 25) for (const x of [0, 1, 600, 1199, 1200]) inside(placeTooltip({ x, y }, SIZE, VP));
  });

  it("works in small windows, a phone and a short laptop", () => {
    for (const vp of [{ w: 375, h: 667 }, { w: 768, h: 500 }, { w: 1024, h: 600 }]) {
      for (let x = 0; x <= vp.w; x += 20) for (let y = 0; y <= vp.h; y += 20) inside(placeTooltip({ x, y }, SIZE, vp), SIZE, vp);
    }
  });

  it("a tooltip larger than the window is pinned to the top-left margin instead of jumping off-screen", () => {
    const p = placeTooltip({ x: 100, y: 100 }, { w: 500, h: 400 }, { w: 300, h: 200 });
    assert.deepEqual([p.left, p.top], [M, M]);
  });

  it("is steady: the same pointer position always gives the same place", () => {
    const a = placeTooltip({ x: 640, y: 410 }, SIZE, VP);
    const b = placeTooltip({ x: 640, y: 410 }, SIZE, VP);
    assert.deepEqual(a, b);
  });
});
