import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isNseSession, marketStatus } from "./session";
import type { Quote } from "./types";

const q = (ts: number, live = true): Quote => ({ symbol: "NIFTY", last: 100, bid: 100, ask: 100, open: 100, high: 100, low: 100, change: 0, changePct: 0, volume: 0, ts, live });
// 2026-10-05 is a Monday. 10:00 IST = 04:30 UTC.
const MON_10AM = Date.parse("2026-10-05T04:30:00Z");

describe("the NSE session", () => {
  it("is open from 9:15 to 15:30 India time on weekdays only", () => {
    assert.equal(isNseSession(MON_10AM), true);
    assert.equal(isNseSession(Date.parse("2026-10-05T03:44:00Z")), false); // 9:14
    assert.equal(isNseSession(Date.parse("2026-10-05T03:45:00Z")), true); // 9:15
    assert.equal(isNseSession(Date.parse("2026-10-05T10:00:00Z")), false); // 15:30
    assert.equal(isNseSession(Date.parse("2026-10-04T04:30:00Z")), false); // Sunday
    assert.equal(isNseSession(Date.parse("2026-10-03T04:30:00Z")), false); // Saturday
  });
});

describe("what to call the data", () => {
  it("is Market open while readings arrive on time, and never live", () => {
    const s = marketStatus([q(MON_10AM - 10_000)], MON_10AM);
    assert.equal(s.kind, "open");
    assert.ok(!/live/i.test(s.label));
  });
  it("is Delayed data when readings stop arriving during the session", () => {
    assert.equal(marketStatus([q(MON_10AM - 5 * 60_000)], MON_10AM).kind, "delayed");
  });
  it("is Market closed outside the session, however fresh the reading", () => {
    assert.equal(marketStatus([q(Date.parse("2026-10-05T12:00:00Z"))], Date.parse("2026-10-05T12:00:01Z")).kind, "closed");
  });
  it("says so when the prices are simulated, and when there are none yet", () => {
    assert.equal(marketStatus([q(MON_10AM, false)], MON_10AM).kind, "simulated");
    assert.equal(marketStatus([null, undefined], MON_10AM).kind, "waiting");
  });
});
