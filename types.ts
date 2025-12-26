
// Domain Types

export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  INR = 'INR',
  GBP = 'GBP',
  JPY = 'JPY'
}

export enum RebalanceFrequency {
  DAILY = 'Daily',
  WEEKLY = 'Weekly',
  BIWEEKLY = 'Bi-Weekly',
  MONTHLY = 'Monthly',
  BIMONTHLY = '2-Month',
  QUARTERLY = 'Quarterly',
  SEMIANNUALLY = 'Semi-Annually',
  ANNUALLY = 'Annually'
}

export enum PriceType {
  OPEN = 'Open',
  HIGH = 'High',
  LOW = 'Low',
  CLOSE = 'Close',
  AVG = 'Average'
}

// New Interface for OHLCV Data
export interface MarketDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SymbolData {
  id: string;
  ticker: string;
  name: string;
  exchange: string;
  defaultCCY: Currency;
  userCCY?: Currency; // Override
  isList: boolean;
  listMembers?: string[]; // IDs of other symbols if this is a list
}

export interface MarketDataProvider {
  id: string;
  name: string;
  type: 'Free' | 'Paid';
}

export interface Rule {
  id: string;
  name: string;
  description: string;
}

export interface StrategyComponent {
  symbolId: string;
  direction: 'Long' | 'Short';
  allocation: number; // Percentage 0-100
}

export interface Strategy {
  id: string;
  name: string;
  type: 'Single' | 'Meta';
  description?: string;
  
  // Configuration
  rebalanceFreq: RebalanceFrequency;
  pricePreference: PriceType;
  executionDelay: number; // days
  initialCapital: number;
  transactionCostPct: number;
  slippagePct: number;
  benchmarkSymbolId: string;
  backtestDuration: string; // e.g., '1Y', '3M'
  onlyTradeOnSignalChange?: boolean; // New: Only trade when MA/Logic triggers a weight shift

  // Logic
  riskOnComponents: StrategyComponent[];
  riskOffComponents: StrategyComponent[];
  rules: { ruleId: string; weight: number }[];
  
  // Meta Strategy Specifics
  subStrategyAllocations?: { strategyId: string; weight: number }[];
}

export interface Transaction {
  date: string;
  ticker: string;
  action: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  totalValue: number;
  cost: number;
  
  // New columns for analysis
  signalReason?: string;
  riskOnNotional?: number;
  riskOnQty?: number;
  riskOnPct?: number;
  riskOffNotional?: number;
  riskOffQty?: number;
  riskOffPct?: number;
  
  // NAV Tracking
  strategyNav?: number;
  benchmarkNav?: number;
}

export interface BacktestResult {
  strategyId: string;
  runDate: string;
  stats: {
    cagr: number;
    maxDrawdown: number;
    sharpeRatio: number;
    totalReturn: number;
    winRate: number;
  };
  navSeries: { date: string; value: number; benchmarkValue: number; riskOn: number; riskOff: number }[];
  allocations: { date: string; riskOn: number; riskOff: number }[];
  transactions: Transaction[];
  latestAllocation?: {
      date: string;
      riskOn: number;
      riskOff: number;
  };
}
