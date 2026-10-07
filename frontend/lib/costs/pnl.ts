/**
 * Gross to net to after-tax: the arithmetic behind "Where did my returns go?".
 *
 * Every cost is subtracted exactly once, in this order: gross result, transaction charges, estimated
 * capital-gains tax. The tax passed in is computed on a gain that is already net of the deductible
 * charges, so charges are not taken off again inside it.
 */
import { roundPaise } from "./rules";

export type NetPnL = { gross: number; charges: number; net: number };

export function calculateNetPnL(input: { gross: number; charges: number }): NetPnL {
  return { gross: roundPaise(input.gross), charges: roundPaise(input.charges), net: roundPaise(input.gross - input.charges) };
}

export type AfterTaxReturn = {
  grossReturnPct: number | null;
  netReturnPct: number | null;
  /** Null for an unrealised position: no tax has been incurred, only a possible one on exit. */
  afterTaxReturnPct: number | null;
  grossPnl: number;
  charges: number;
  netPnl: number;
  tax: number | null;
  afterTaxPnl: number | null;
  /** 'After-tax return' for realised results, 'Estimated after-tax value on redemption' otherwise. */
  label: string;
};

/**
 * Gross, net and after-tax return on `invested`. Tax is applied only to a realised result; for an
 * open position the after-tax figure is withheld and the label says what a redemption would be.
 */
export function calculateAfterTaxReturn(input: {
  invested: number;
  gross: number;
  charges: number;
  tax: number | null;
  realized: boolean;
}): AfterTaxReturn {
  const { invested, gross, charges, tax, realized } = input;
  const pct = (x: number) => (invested > 0 ? (x / invested) * 100 : null);
  const net = roundPaise(gross - charges);
  const afterTaxPnl = realized && tax != null ? roundPaise(net - tax) : null;
  return {
    grossReturnPct: pct(gross),
    netReturnPct: pct(net),
    afterTaxReturnPct: afterTaxPnl == null ? null : pct(afterTaxPnl),
    grossPnl: roundPaise(gross),
    charges: roundPaise(charges),
    netPnl: net,
    tax: realized ? tax : null,
    afterTaxPnl,
    label: realized ? "After-tax return" : "Estimated after-tax value on redemption",
  };
}

export type CostImpact = {
  gross: number;
  charges: number;
  /** Realised result after charges, before tax. */
  netBeforeTax: number;
  tax: number | null;
  /** Null when the tax could not be estimated. */
  netAfterTax: number | null;
};

/** The "Where did my returns go?" ladder for a realised result. */
export function costImpact(input: { gross: number; charges: number; tax: number | null }): CostImpact {
  const netBeforeTax = roundPaise(input.gross - input.charges);
  return {
    gross: roundPaise(input.gross),
    charges: roundPaise(input.charges),
    netBeforeTax,
    tax: input.tax,
    netAfterTax: input.tax == null ? null : roundPaise(netBeforeTax - input.tax),
  };
}
