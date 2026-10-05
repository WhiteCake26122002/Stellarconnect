/** `def` is the plain-English line for Simple mode; `tech`, when present, replaces it in Detailed mode. */
export type GlossaryEntry = { term: string; def: string; tech?: string };

export const GLOSSARY = {
  dcf: {
    term: "DCF (discounted cash flow)",
    def: "A way to value a company: estimate the cash it will make in future years, shrink each year back into today's money, and add it all up.",
  },
  base_case: {
    term: "Base case",
    def: "The middle-of-the-road estimate, using the model's default assumptions. Not the most hopeful or the most cautious view.",
  },
  scenarios: {
    term: "Bear, Base and Bull",
    def: "Three versions of the future. Bear is a pessimistic case, Base is the middle case, and Bull is an optimistic case.",
  },
  intrinsic_value: {
    term: "Intrinsic value",
    def: "What the model thinks one share is worth from the company's future cash, as opposed to what the market pays today.",
  },
  undervalued: {
    term: "Undervalued / overvalued",
    def: "Undervalued means today's price is below the model's value; overvalued means it is above. It is a comparison, not a buy or sell signal.",
  },
  enterprise_value: {
    term: "Enterprise value (EV)",
    def: "The value of the whole business: what it is worth to everyone who funds it, lenders and shareholders together.",
    tech: "PV of explicit-period FCFF plus PV of terminal value: the value of operating assets to all capital providers.",
  },
  equity_value: {
    term: "Equity value",
    def: "The part of the business that belongs to shareholders: enterprise value plus cash, minus debt and other claims.",
    tech: "EV plus cash and non-operating investments, less debt, leases, NCI and preferred stock: the residual claim of common shareholders.",
  },
  pv_explicit_fcf: {
    term: "PV of forecast cash flows",
    def: "The free cash flow from each forecast year, shrunk back into today's money and added up.",
    tech: "Sum of explicit-period FCFF, each discounted at WACC to the valuation date.",
  },
  bridge_cash: {
    term: "Cash & cash-like",
    def: "Cash and short-term investments the company holds, added to enterprise value because they belong to shareholders.",
    tech: "Cash, equivalents and marketable securities held outside operations, added to enterprise value in the equity bridge.",
  },
  non_operating_investments: {
    term: "Non-operating investments",
    def: "Investments the business doesn't need to run day to day, such as stakes in other companies, added to enterprise value.",
    tech: "Investments excluded from FCFF (long-term, associate and other non-operating holdings), added to enterprise value.",
  },
  total_debt: {
    term: "Total debt",
    def: "Money the company has borrowed, subtracted from enterprise value because lenders are paid before shareholders.",
    tech: "Short- and long-term borrowings excluding leases, subtracted from enterprise value to reach equity value.",
  },
  leases: {
    term: "Leases",
    def: "What the company still owes on leases for offices, stores and equipment, subtracted from enterprise value to reach equity value.",
    tech: "Operating and finance lease liabilities, subtracted from enterprise value to reach equity value.",
  },
  minority_interest: {
    term: "Minority interest",
    def: "The slice of partly-owned subsidiaries that belongs to other shareholders, subtracted because it isn't ours.",
    tech: "Non-controlling interest (NCI) in consolidated subsidiaries, subtracted from enterprise value to reach equity value.",
  },
  wacc: {
    term: "WACC (weighted average cost of capital)",
    def: "The yearly return investors expect for funding this company, blending what shareholders and lenders want. Future cash is shrunk into today's money at this rate.",
  },
  terminal_growth: {
    term: "Terminal growth (g)",
    def: "How fast the company is assumed to grow every year after the forecast ends, forever. It is kept low, near the long-run growth of the economy.",
  },
  terminal_value: {
    term: "Terminal value",
    def: "The value today of all the cash the company makes after the forecast years. It is often most of the total, shown as a share of enterprise value (EV).",
    tech: "Gordon-growth value FCFF_n × (1 + g) / (WACC − g), discounted back from the final forecast year.",
  },
  upside: {
    term: "Upside / downside",
    def: "How far the model's value per share sits above (upside) or below (downside) today's market price, in percent.",
  },
  ebitda_margin: {
    term: "EBITDA margin",
    def: "Operating profit as a share of sales, before interest, tax, depreciation and amortisation. A 25% margin means 25 of profit on every 100 of sales.",
  },
  ebit_margin: {
    term: "EBIT margin",
    def: "Operating profit as a share of sales after depreciation, but before interest and tax.",
  },
  cagr: {
    term: "CAGR (compound annual growth rate)",
    def: "The steady yearly growth rate that would take a number from its first value to its last value over the period.",
  },
  reliability: {
    term: "Model reliability",
    def: "A 0–100 score for how far to trust this valuation, based on how complete and consistent the data and assumptions are.",
  },
  fcff: {
    term: "Free cash flow (FCFF)",
    def: "Cash the business has left after running costs, taxes and investment in growth. \"Unlevered\" means before paying lenders. This is the cash a DCF values.",
  },
  equity_bridge: {
    term: "Equity bridge",
    def: "The steps from the whole business's value (enterprise value) to the shareholders' value: add cash and investments, subtract debt and other claims.",
  },
  present_value: {
    term: "Present value (PV)",
    def: "What a future amount of money is worth today. Money later is worth less than money now, so future cash is shrunk, or \"discounted\".",
  },
  discount_factor: {
    term: "Discount factor",
    def: "The number each future year's cash is multiplied by to turn it into today's money. Years further out get smaller factors.",
  },
  sensitivity: {
    term: "Sensitivity table",
    def: "A grid showing how the value per share moves when two assumptions are nudged up or down. It shows how much the answer leans on them.",
  },
  forecast_horizon: {
    term: "Forecast horizon",
    def: "How many years the model forecasts one at a time before switching to a single long-run growth assumption.",
  },
  long_term_growth: {
    term: "Long-term growth",
    def: "The growth rate sales settle toward by the end of the forecast. Here it is kept equal to terminal growth.",
  },
  growth_source: {
    term: "Revenue growth source",
    def: "Where next year's sales growth comes from: the company's evidence and guidance, the last two years, or an AI-written explanation that cannot change the numbers.",
  },
  risk_free_rate: {
    term: "Risk-free rate",
    def: "The return on a safe government bond. Any riskier investment should earn at least this much.",
  },
  beta: {
    term: "Beta",
    def: "How much a stock tends to move compared with the whole market. 1 moves with the market; above 1 swings more; below 1 swings less.",
  },
  equity_risk_premium: {
    term: "Equity risk premium",
    def: "The extra yearly return investors expect for owning shares instead of safe government bonds.",
  },
  cost_of_debt: {
    term: "Pre-tax cost of debt",
    def: "The interest rate the company pays to borrow, before the tax saving on interest.",
  },
  size_premium: {
    term: "Size premium",
    def: "An extra return added for smaller companies, which tend to be riskier. Usually zero for large companies.",
  },
  exit_multiple: {
    term: "Exit multiple",
    def: "A cross-check on terminal value: what the business might sell for, as a multiple of its yearly operating profit (EBITDA).",
  },
  preferred_stock: {
    term: "Preferred stock",
    def: "Shares that are paid before ordinary shareholders. Their value is subtracted before the value per ordinary share.",
    tech: "Preferred equity claims senior to common shareholders, subtracted from enterprise value to reach equity value.",
  },
  equity_weight: {
    term: "Target equity weight",
    def: "The share of the company's funding that comes from shareholders rather than lenders. It sets how WACC blends the two costs.",
  },
  capex: {
    term: "Capex (capital expenditure)",
    def: "Money spent on long-lived assets such as factories, equipment and software.",
  },
  nwc: {
    term: "Net working capital (NWC)",
    def: "Money tied up in day-to-day operations: stock and unpaid customer bills, minus unpaid supplier bills.",
  },
  income_statement: {
    term: "Income statement",
    def: "Sales, costs and profit over a year.",
  },
  balance_sheet: {
    term: "Balance sheet",
    def: "What the company owns and owes on the last day of the year.",
  },
  cash_flow_statement: {
    term: "Cash flow statement",
    def: "The cash that actually came in and went out during the year.",
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryId = keyof typeof GLOSSARY;
