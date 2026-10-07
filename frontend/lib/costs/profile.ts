/**
 * The investor's tax profile: the little the estimates need that the app cannot know (a slab rate for
 * gains taxed at slab, an income band for surcharge, the regime). Kept in the browser, per account,
 * and shared by the paper-trading and mutual-fund desks so one answer serves both. Nothing here is
 * sent anywhere except as query parameters on a tax estimate the user asked for.
 */
import { EMPTY_TAX_PROFILE, type TaxProfile } from "./tax";
import { TAX_RULES } from "./rules";

const KEY = "connect-tax-profile-v1";

function storageKey(owner: string | null | undefined) {
  return `${KEY}:${owner || "anon"}`;
}

export function sanitizeProfile(raw: Partial<TaxProfile> | null | undefined): TaxProfile {
  const slab = typeof raw?.slabRatePct === "number" && raw.slabRatePct >= 0 && raw.slabRatePct <= 45 ? raw.slabRatePct : null;
  const band = typeof raw?.incomeBand === "string" && raw.incomeBand in TAX_RULES.surcharge.bands ? raw.incomeBand : null;
  return { slabRatePct: slab, incomeBand: band, regime: raw?.regime === "old" ? "old" : "new" };
}

export function loadTaxProfile(owner: string | null | undefined): TaxProfile {
  try {
    const raw = localStorage.getItem(storageKey(owner));
    return raw ? sanitizeProfile(JSON.parse(raw)) : { ...EMPTY_TAX_PROFILE };
  } catch {
    return { ...EMPTY_TAX_PROFILE };
  }
}

export function saveTaxProfile(owner: string | null | undefined, profile: TaxProfile) {
  try {
    localStorage.setItem(storageKey(owner), JSON.stringify(sanitizeProfile(profile)));
  } catch {
    /* private window or quota: the profile just does not persist */
  }
}

/** True when the profile gives the estimate everything it can use. */
export function profileComplete(p: TaxProfile): boolean {
  return p.incomeBand != null && p.slabRatePct != null;
}

/** Query-string form for the mutual-fund tax endpoints. */
export function profileParams(p: TaxProfile): Record<string, string> {
  const out: Record<string, string> = {};
  if (p.slabRatePct != null) out.slab = String(p.slabRatePct);
  if (p.incomeBand) out.band = p.incomeBand;
  out.regime = p.regime;
  return out;
}
