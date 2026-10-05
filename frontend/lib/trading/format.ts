export function inr(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const body = abs.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? "−" : ""}₹${body}`;
}

export function signedInr(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function px(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signedPx(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function vol(n: number) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function pct(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${(Math.abs(n) * 100).toFixed(digits)}%`;
}

export function compactMoney(n: number, currency = "INR") {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  const prefix = currency === "INR" ? "₹" : currency === "USD" ? "$" : "";
  const suffix = prefix ? "" : ` ${currency}`;
  if (currency === "INR" && abs >= 1e7) return `${sign}${prefix}${(abs / 1e7).toFixed(2)} Cr${suffix}`;
  if (abs >= 1e12) return `${sign}${prefix}${(abs / 1e12).toFixed(2)}T${suffix}`;
  if (abs >= 1e9) return `${sign}${prefix}${(abs / 1e9).toFixed(2)}B${suffix}`;
  if (abs >= 1e6) return `${sign}${prefix}${(abs / 1e6).toFixed(2)}M${suffix}`;
  return `${sign}${prefix}${abs.toLocaleString("en-IN", { maximumFractionDigits: 2 })}${suffix}`;
}

export function ratioText(value: number | null | undefined, format: "pct" | "number" | "money", currency = "INR") {
  if (value == null || !Number.isFinite(value)) return "—";
  if (format === "pct") return pct(value);
  if (format === "money") return compactMoney(value, currency);
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function indexLevel(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 100) return Math.round(n).toLocaleString("en-IN");
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function rrText(ratio: number) {
  if (!ratio) return "—";
  return `1 : ${ratio.toFixed(2)}`;
}

export function dur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}
