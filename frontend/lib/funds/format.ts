const LOCALE = "en-IN";

export function rupees(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `₹${value.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function rupeesCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}k`;
  return `${sign}₹${abs.toFixed(0)}`;
}

function withSign(value: number, body: string): string {
  if (value > 0) return `+${body}`;
  if (value < 0) return `−${body}`;
  return body;
}

export function signedRupees(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return withSign(value, rupees(Math.abs(value)));
}

/** A value already in percent (e.g. the API's `return_1y`). */
export function signedPoints(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return withSign(value, `${Math.abs(value).toFixed(digits)}%`);
}

/** A fraction (0.12) shown as a signed percent. */
export function signedFrac(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return withSign(value, `${Math.abs(value * 100).toFixed(digits)}%`);
}

export function frac(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

export function ratio(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return value.toFixed(digits);
}

export function tone(value: number | null | undefined): "" | "bull" | "bear" {
  if (value == null || value === 0 || Number.isNaN(value)) return "";
  return value > 0 ? "bull" : "bear";
}

export const shortDate = (t: number) => new Date(t).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "2-digit" });
export const longDate = (t: number) => new Date(t).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
export const monthYear = (t: number) => new Date(t).toLocaleDateString(LOCALE, { month: "short", year: "numeric" });

export function yearsText(years: number): string {
  if (years < 1) return `${Math.max(1, Math.round(years * 12))} mo`;
  return `${years.toFixed(1)} yr`;
}
