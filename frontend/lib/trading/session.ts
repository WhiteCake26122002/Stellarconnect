import type { Quote } from "./types";

const IST_OFFSET_MIN = 330;
const OPEN_MIN = 9 * 60 + 15;
const CLOSE_MIN = 15 * 60 + 30;
/** The quote feed refreshes every 20 seconds; a reading two minutes old means the refresh has stopped working. */
export const DELAYED_AFTER_MS = 2 * 60_000;

/** True during NSE's regular session: Monday to Friday, 9:15 to 15:30 India time. Exchange holidays are not known here. */
export function isNseSession(now: number): boolean {
  const ist = new Date(now + IST_OFFSET_MIN * 60_000);
  const day = ist.getUTCDay();
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return day >= 1 && day <= 5 && minutes >= OPEN_MIN && minutes < CLOSE_MIN;
}

export type MarketStatus = {
  kind: "open" | "closed" | "delayed" | "simulated" | "waiting";
  label: string;
  /** Time of the most recent reading, in ms; null before any has arrived. */
  updatedAt: number | null;
};

/**
 * What to call the data on screen. A reading is never called live: it is "Market open" while it keeps arriving on
 * time, "Delayed data" when it has stopped arriving during the session, and simulated prices say so.
 */
export function marketStatus(quotes: (Quote | null | undefined)[], now: number): MarketStatus {
  const have = quotes.filter((q): q is Quote => !!q && q.last > 0);
  if (!have.length) return { kind: "waiting", label: "Waiting for prices", updatedAt: null };
  const updatedAt = Math.max(...have.map((q) => q.ts || 0)) || null;
  if (have.every((q) => q.live === false)) return { kind: "simulated", label: "Simulated prices", updatedAt };
  if (!isNseSession(now)) return { kind: "closed", label: "Market closed", updatedAt };
  if (updatedAt != null && now - updatedAt > DELAYED_AFTER_MS) return { kind: "delayed", label: "Delayed data", updatedAt };
  return { kind: "open", label: "Market open", updatedAt };
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
