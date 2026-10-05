export type WorldMarket = {
  symbol: string;
  name: string;
  index: string;
  iso: string;
  country: string;
  yahoo: string;
  base: number;
};

export const WORLD_MARKETS: WorldMarket[] = [
  { symbol: "SPX", name: "S&P 500", index: "S&P 500", iso: "US", country: "United States", yahoo: "^GSPC", base: 5600 },
  { symbol: "NIFTY", name: "NIFTY 50", index: "NIFTY 50", iso: "IN", country: "India", yahoo: "^NSEI", base: 23231 },
  { symbol: "N225", name: "Nikkei 225", index: "Nikkei 225", iso: "JP", country: "Japan", yahoo: "^N225", base: 39000 },
  { symbol: "FTSE", name: "FTSE 100", index: "FTSE 100", iso: "GB", country: "United Kingdom", yahoo: "^FTSE", base: 8200 },
  { symbol: "DAX", name: "DAX", index: "DAX", iso: "DE", country: "Germany", yahoo: "^GDAXI", base: 18000 },
  { symbol: "CAC", name: "CAC 40", index: "CAC 40", iso: "FR", country: "France", yahoo: "^FCHI", base: 7500 },
  { symbol: "SSEC", name: "Shanghai Composite", index: "SSE Composite", iso: "CN", country: "China", yahoo: "000001.SS", base: 3200 },
  { symbol: "HSI", name: "Hang Seng", index: "Hang Seng", iso: "HK", country: "Hong Kong", yahoo: "^HSI", base: 18000 },
  { symbol: "KS11", name: "KOSPI", index: "KOSPI", iso: "KR", country: "South Korea", yahoo: "^KS11", base: 2600 },
  { symbol: "AXJO", name: "ASX 200", index: "S&P/ASX 200", iso: "AU", country: "Australia", yahoo: "^AXJO", base: 7800 },
  { symbol: "BVSP", name: "Bovespa", index: "Bovespa", iso: "BR", country: "Brazil", yahoo: "^BVSP", base: 130000 },
  { symbol: "GSPTSE", name: "TSX", index: "S&P/TSX", iso: "CA", country: "Canada", yahoo: "^GSPTSE", base: 24000 },
  { symbol: "TWII", name: "TAIEX", index: "TAIEX", iso: "TW", country: "Taiwan", yahoo: "^TWII", base: 22000 },
  { symbol: "FTMIB", name: "FTSE MIB", index: "FTSE MIB", iso: "IT", country: "Italy", yahoo: "FTSEMIB.MI", base: 34000 },
  { symbol: "IBEX", name: "IBEX 35", index: "IBEX 35", iso: "ES", country: "Spain", yahoo: "^IBEX", base: 11000 },
  { symbol: "AEX", name: "AEX", index: "AEX", iso: "NL", country: "Netherlands", yahoo: "^AEX", base: 900 },
  { symbol: "SSMI", name: "SMI", index: "SMI", iso: "CH", country: "Switzerland", yahoo: "^SSMI", base: 12000 },
  { symbol: "MXX", name: "IPC", index: "S&P/BMV IPC", iso: "MX", country: "Mexico", yahoo: "^MXX", base: 52000 },
  { symbol: "JKSE", name: "Jakarta Composite", index: "Jakarta Composite", iso: "ID", country: "Indonesia", yahoo: "^JKSE", base: 7200 },
  { symbol: "STI", name: "Straits Times", index: "Straits Times", iso: "SG", country: "Singapore", yahoo: "^STI", base: 3400 },
  { symbol: "J203", name: "JSE All Share", index: "JSE All Share", iso: "ZA", country: "South Africa", yahoo: "^J203.JO", base: 76000 },
  { symbol: "TASI", name: "Tadawul All Share", index: "TASI", iso: "SA", country: "Saudi Arabia", yahoo: "^TASI.SR", base: 12000 },
  { symbol: "XU100", name: "BIST 100", index: "BIST 100", iso: "TR", country: "Turkey", yahoo: "XU100.IS", base: 9000 },
  { symbol: "WIG20", name: "WIG20", index: "WIG20", iso: "PL", country: "Poland", yahoo: "WIG20.WA", base: 2400 },
  { symbol: "OMX", name: "OMX Stockholm 30", index: "OMX S30", iso: "SE", country: "Sweden", yahoo: "^OMX", base: 2500 },
  { symbol: "OSEBX", name: "Oslo Bors", index: "OSEBX", iso: "NO", country: "Norway", yahoo: "OSEBX.OL", base: 1400 },
  { symbol: "BFX", name: "BEL 20", index: "BEL 20", iso: "BE", country: "Belgium", yahoo: "^BFX", base: 4300 },
  { symbol: "ATX", name: "ATX", index: "ATX", iso: "AT", country: "Austria", yahoo: "^ATX", base: 3600 },
  { symbol: "PSI20", name: "PSI 20", index: "PSI 20", iso: "PT", country: "Portugal", yahoo: "PSI20.LS", base: 6500 },
  { symbol: "ASE", name: "Athens General", index: "ASE", iso: "GR", country: "Greece", yahoo: "GD.AT", base: 1400 },
  { symbol: "ISEQ", name: "ISEQ Overall", index: "ISEQ", iso: "IE", country: "Ireland", yahoo: "^ISEQ", base: 9500 },
  { symbol: "NZ50", name: "NZX 50", index: "NZX 50", iso: "NZ", country: "New Zealand", yahoo: "^NZ50", base: 12500 },
  { symbol: "IPSA", name: "S&P IPSA", index: "IPSA", iso: "CL", country: "Chile", yahoo: "SPIPSA.SN", base: 6500 },
  { symbol: "MERV", name: "S&P Merval", index: "Merval", iso: "AR", country: "Argentina", yahoo: "^MERV", base: 1400000 },
  { symbol: "SET", name: "SET Index", index: "SET", iso: "TH", country: "Thailand", yahoo: "^SET.BK", base: 1400 },
  { symbol: "KLSE", name: "FTSE KLCI", index: "KLCI", iso: "MY", country: "Malaysia", yahoo: "^KLSE", base: 1600 },
  { symbol: "PSEI", name: "PSEi", index: "PSEi", iso: "PH", country: "Philippines", yahoo: "PSEI.PS", base: 6700 },
  { symbol: "TA35", name: "TA-35", index: "TA-35", iso: "IL", country: "Israel", yahoo: "TA35.TA", base: 2000 },
  { symbol: "EGX30", name: "EGX 30", index: "EGX 30", iso: "EG", country: "Egypt", yahoo: "^CASE30", base: 30000 },
  { symbol: "IMOEX", name: "MOEX Russia", index: "IMOEX", iso: "RU", country: "Russia", yahoo: "IMOEX.ME", base: 2700 },
];

export const WORLD_SYMBOLS = WORLD_MARKETS.map((m) => m.symbol);

export function worldMarketByIso(iso: string) {
  return WORLD_MARKETS.find((m) => m.iso === iso) || null;
}

export function worldMarketBySymbol(symbol: string) {
  return WORLD_MARKETS.find((m) => m.symbol === symbol) || null;
}
