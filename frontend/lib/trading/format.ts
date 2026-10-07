export function inr(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const body = abs.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? "−" : ""}₹${body}`;
}

export function signedInr(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  // An amount that rounds to nothing carries no sign: "−₹0.00" would claim a loss that is not there.
  const zero = Number(Math.abs(n).toFixed(digits)) === 0;
  const sign = zero ? "" : n > 0 ? "+" : "−";
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
  const zero = Number((Math.abs(n) * 100).toFixed(digits)) === 0;
  const sign = zero ? "" : n > 0 ? "+" : "−";
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


export function dur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}

/** ₹10.6L, ₹4k, ₹1.2Cr: a short money label for chart axes and compact tables. */
export function compactInr(n: number, signed = false) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2).replace(/\.?0+$/, "")}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(abs >= 1e6 ? 1 : 2).replace(/\.?0+$/, "")}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(/\.0$/, "")}k`;
  return `${sign}₹${abs.toFixed(0)}`;
}

/** 42.1% from 0.421. */
export function weightPct(fraction: number, digits = 1) {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}
