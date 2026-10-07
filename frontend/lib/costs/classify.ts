/**
 * Which charge schedule and which tax treatment a simulated instrument gets.
 *
 * Charges: equity (delivery or intraday), futures and options have Indian schedules; commodities,
 * currencies, crypto and foreign indices do not, and say so instead of being charged a made-up rate.
 * Tax: delivery equity shares and ETFs are capital gains (equity-oriented ETFs under the equity
 * rules, gold and debt ETFs under the 'other' rules); intraday trades and F&O are business income
 * and are left out of the capital-gains estimate with the reason stated.
 */
import type { Product, SymbolInfo } from "../trading/types";
import type { ExchangeName, Segment } from "./charges";
import { CHARGES, TAX_RULES } from "./rules";

export type { Product };

export type ChargeTarget =
  | { modelled: true; segment: Segment; exchange: ExchangeName; equity: boolean; note: string | null }
  | { modelled: false; reason: string };

const EXCHANGE_OF: Record<string, ExchangeName | undefined> = { NSE: "NSE", NFO: "NSE", BSE: "BSE" };

export function isEquityInstrument(info: Pick<SymbolInfo, "assetClass">): boolean {
  return CHARGES.instrumentMap[info.assetClass] === "equity";
}

export function chargeTarget(info: Pick<SymbolInfo, "assetClass" | "exchange" | "symbol">, product: Product): ChargeTarget {
  const map = CHARGES.instrumentMap;
  if (map.unmodelled.includes(info.assetClass) || map.unmodelledExchanges.includes(info.exchange)) {
    return { modelled: false, reason: `No Indian charge schedule is modelled for ${info.exchange} ${info.assetClass} instruments, so this trade carries no charges.` };
  }
  const exchange = EXCHANGE_OF[info.exchange];
  const kind = map[info.assetClass];
  if (!exchange || typeof kind !== "string") {
    return { modelled: false, reason: `No charge schedule is modelled for ${info.symbol}.` };
  }
  if (kind === "equity") {
    return { modelled: true, segment: product === "intraday" ? "equityIntraday" : "equityDelivery", exchange, equity: true, note: null };
  }
  if (kind === "futures" || kind === "options") {
    const note =
      info.assetClass === "index"
        ? "An index is not directly tradable in India, so it is charged as an index future."
        : null;
    return { modelled: true, segment: kind, exchange, equity: false, note };
  }
  return { modelled: false, reason: `No charge schedule is modelled for ${info.symbol}.` };
}

export type TaxTreatment =
  | { kind: "capital_gains"; taxClass: "equity" | "other"; label: string }
  | { kind: "business_income"; reason: string }
  | { kind: "not_modelled"; reason: string };

/** Tax treatment of a closed position's gain. */
export function taxTreatment(info: Pick<SymbolInfo, "assetClass" | "exchange" | "symbol" | "name">, product: Product): TaxTreatment {
  const rules = TAX_RULES.securityClassification;
  const target = chargeTarget(info, product);
  if (!target.modelled) return { kind: "not_modelled", reason: target.reason };
  if (rules.businessIncomeProducts.includes(product) && target.equity) {
    return { kind: "business_income", reason: "Intraday equity trades are generally speculative business income, taxed at your slab rate, not capital gains." };
  }
  if (rules.businessIncomeAssetClasses.includes(info.assetClass)) {
    return { kind: "business_income", reason: "Futures and options income is generally business income taxed at your slab rate, not capital gains." };
  }
  if (info.assetClass === "etf") {
    const text = `${info.name} ${info.symbol}`.toLowerCase();
    if (rules.otherEtfKeywords.some((k) => text.includes(k))) {
      return { kind: "capital_gains", taxClass: "other", label: "Listed ETF (not equity-oriented)" };
    }
    return { kind: "capital_gains", taxClass: "equity", label: "Equity-oriented ETF" };
  }
  return { kind: "capital_gains", taxClass: "equity", label: "Listed equity share" };
}
