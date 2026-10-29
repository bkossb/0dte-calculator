export type InstrumentConfig = {
  symbol: string;
  label: string;
  exchange: string;
  cfdSymbol: string;
  futuresSymbol: string;
  option: string;
  description: string;
  dataSource: string;
  wall: { tolerance: number; leaderThreshold: number; maxWalls: number; minMetric: number };
};

export const CONFLUENCE_TOLERANCE_PCT = 0.25;

export const instruments: InstrumentConfig[] = [
  { symbol: '^NDX', label: 'NDX', exchange: 'NASDAQ', cfdSymbol: 'US100', futuresSymbol: 'NQ=F', option: 'NDX · US100 · QQQ confirm', description: 'Nasdaq-100 index options · QQQ confluence', dataSource: 'YAHOO FINANCE', wall: { tolerance: 0.02, leaderThreshold: 0.33, maxWalls: 3, minMetric: 0 } },
  { symbol: 'SPY', label: 'SPY', exchange: 'NYSE ARCA', cfdSymbol: 'US500', futuresSymbol: 'ES=F', option: 'SPY · US500 · SPX confirm', description: 'S&P 500 ETF options · SPX confluence', dataSource: 'YAHOO FINANCE', wall: { tolerance: 0.04, leaderThreshold: 0.33, maxWalls: 3, minMetric: 0 } },
  { symbol: 'DIA', label: 'DIA', exchange: 'NYSE ARCA', cfdSymbol: 'US30', futuresSymbol: 'YM=F', option: 'DIA · US30', description: 'SPDR Dow Jones Industrial Average ETF Trust · US30', dataSource: 'YAHOO FINANCE', wall: { tolerance: 0.04, leaderThreshold: 0.33, maxWalls: 3, minMetric: 0 } },
  { symbol: 'GLD', label: 'GLD', exchange: 'NYSE ARCA', cfdSymbol: 'XAUUSD', futuresSymbol: 'GC=F', option: 'GLD · XAUUSD', description: 'SPDR Gold Shares · XAUUSD proxy', dataSource: 'YAHOO FINANCE', wall: { tolerance: 0.04, leaderThreshold: 0.33, maxWalls: 3, minMetric: 0 } },
  { symbol: '^GDAXI', label: 'DAX', exchange: 'EUREX', cfdSymbol: 'DE40', futuresSymbol: 'FDAX', option: 'DAX · DE40 · Eurex ODAP', description: 'DAX index · Eurex End-of-Day Options (weekly)', dataSource: 'EUREX · YAHOO FINANCE', wall: { tolerance: 0.02, leaderThreshold: 0.10, maxWalls: 4, minMetric: 10 } },
];
